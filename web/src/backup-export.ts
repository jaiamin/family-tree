import { assert } from "./model";
import { createBackup } from "./backup";
import type { Env } from "./types";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
export function base64(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i+32768));
  return btoa(text);
}
export const unbase64 = (text: string) => Uint8Array.from(atob(text), character => character.charCodeAt(0));
async function exportKey(encoded: string, usage: "encrypt" | "decrypt") {
  const key = unbase64(encoded);
  assert(key.length === 32, "Use a 256-bit recovery key.");
  return crypto.subtle.importKey("raw", key, "AES-GCM", false, [usage]);
}
const associated = (records: number, index: number) => new TextEncoder().encode(`family-tree-export:1:${records}:${index}`);
export async function encryptedBackup(env: Env, encodedKey: string) {
  const snapshot = await createBackup(env), key = await exportKey(encodedKey, "encrypt");
  const count = snapshot.uploads.length+1;
  let index = -1;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index === -1) { controller.enqueue(encode({ format: 1, records: count })); controller.enqueue(new Uint8Array([10])); index=0; return; }
      if (index === count) { controller.close(); return; }
      let value: unknown = { kind: "manifest", value: snapshot };
      if (index > 0) {
        const upload = snapshot.uploads[index-1], object = await env.BACKUP.get(upload.object_key);
        assert(object, "A retained backup photo is missing.");
        value = { kind: "photo", key: upload.object_key, data: base64(new Uint8Array(await object.arrayBuffer())), contentType: upload.content_type };
      }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: associated(count,index) }, key, encode(value));
      controller.enqueue(encode({ iv: base64(iv), data: base64(new Uint8Array(encrypted)) })); controller.enqueue(new Uint8Array([10])); index++;
    },
  });
}

// Maintenance-only streaming import. It stages encrypted-export contents in a
// fresh backup destination, then the regular integrity-checked restore runs.
export async function stageEncryptedBackup(env: Env, stream: ReadableStream<Uint8Array>, encodedKey: string) {
  assert(!(await env.BACKUP.list()).objects.length, "Encrypted import requires a fresh backup destination.");
  const key = await exportKey(encodedKey,"decrypt"), reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "", header: { format: number; records: number } | undefined, index=0, manifest: Awaited<ReturnType<typeof createBackup>> | undefined;
  const accept = async (line: string) => {
    const item = JSON.parse(line);
    if (!header) { assert(item.format === 1 && Number.isSafeInteger(item.records) && item.records > 0 && item.records <= 100001,"Unsupported encrypted export."); header=item; return; }
    assert(index < header.records,"Unexpected export records.");
    const plain = await crypto.subtle.decrypt({name:"AES-GCM",iv:unbase64(item.iv),additionalData:associated(header.records,index)},key,unbase64(item.data));
    const record = JSON.parse(new TextDecoder().decode(plain));
    if (index === 0) { assert(record.kind === "manifest","Missing export manifest."); manifest=record.value; assert(manifest && manifest.uploads.length+1 === header.records,"Incomplete export."); }
    else {
      const expected = manifest!.uploads[index-1];
      assert(record.kind === "photo" && record.key === expected.object_key && record.contentType === expected.content_type,"Invalid export photo.");
      await env.BACKUP.put(record.key,unbase64(record.data),{httpMetadata:{contentType:record.contentType}});
    }
    index++;
  };
  while (true) {
    const {done,value}=await reader.read(); if (done) break;
    buffer+=value;
    let newline;
    while ((newline=buffer.indexOf("\n")) >= 0) { const line=buffer.slice(0,newline); buffer=buffer.slice(newline+1); if(line) await accept(line); }
    assert(buffer.length <= 30_000_000,"Export record is too large.");
  }
  if (buffer) await accept(buffer);
  assert(header && index === header.records && manifest,"The export is truncated.");
  await env.BACKUP.put("collection.json",JSON.stringify(manifest));
}
