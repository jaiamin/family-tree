// Run after build: node scripts/benchmark.mjs [baseline worker path] [result path].
// Requires agent-browser; uses disposable synthetic D1/R2, never production or .local.
import { migratePublicIds } from "../dist/public-ids.mjs";
import { runtime } from "../tests/support.mjs";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";

const session = "performance-benchmark";
const browser = (...args) => execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8" }).trim();
const mf = await runtime({ port: 0, host: "127.0.0.1", ...process.argv[2] ? { scriptPath: resolve(process.argv[2]) } : {} });
let ws;
try {
  const origin = String(await mf.ready).replace(/\/$/, ""), base = `${origin}/family-tree`;
  const db = await mf.getD1Database("DB"), bucket = await mf.getR2Bucket("PHOTOS"), backup = await mf.getR2Bucket("BACKUP");
  const ids = Array.from({ length: 256 }, () => randomUUID()), tree = randomUUID();
  await db.batch([
    db.prepare("INSERT INTO collections(id,site,operation,actor,reason) VALUES ('main',NULL,'bench','bench','Synthetic benchmark')"),
    db.prepare("INSERT INTO trees(id,name) VALUES (?, 'Synthetic family')").bind(tree),
    ...ids.map((id, i) => db.prepare("INSERT INTO people(id,name,sex,birth_date) VALUES (?,?,?,?)").bind(id, `Relative ${i + 1}`, i % 2 ? "female" : "male", `${1940 + Math.floor(i / 8)}-01-01`)),
    ...ids.map((id, i) => db.prepare("INSERT INTO tree_members(tree_id,person_id,position) VALUES (?,?,?)").bind(tree, id, i)),
    ...ids.slice(2).map((id, i) => db.prepare("INSERT INTO parents(child_id,parent_id) VALUES (?,?)").bind(id, ids[Math.floor(i / 2)])),
  ]);
  await migratePublicIds({ DB: db });
  const treeShortId = (await db.prepare("SELECT short_id FROM public_ids WHERE kind = 'tree' AND entity_id = ?").bind(tree).first()).short_id;
  const personShortId = (await db.prepare("SELECT short_id FROM public_ids WHERE kind = 'person' AND entity_id = ?").bind(ids[0]).first()).short_id;
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2kAAAAASUVORK5CYII=", "base64");
  for (const id of ids.slice(0, 16)) {
    await bucket.put(id, image, { httpMetadata: { contentType: "image/png" } });
    await backup.put(id, image, { httpMetadata: { contentType: "image/png" } });
    const hash = Buffer.from(await crypto.subtle.digest("SHA-256",image)).toString("hex");
    await db.prepare("INSERT INTO photo_uploads(id,person_id,object_key,content_type,content_hash) VALUES(?,?,?,?,?)").bind(id,id,id,"image/png",hash).run();
    await db.prepare("INSERT INTO photos(person_id,object_key,version) VALUES (?,?,?)").bind(id, id, id).run();
  }
  const login = await mf.dispatchFetch(`${base}/api/login`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ password: "local-preview-only" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const headers = { cookie };
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const results = { environment: "Local Miniflare; synthetic 256-person tree, 16 tiny PNG photos; Chromium 4x CPU, 100ms latency, 1.6Mbps download; 5 cold/warm pairs", api: {}, browser: {} };
  for (const path of ["/api/session", "/api/view", `/api/view?tree=${treeShortId}`, `/api/photos/${ids[0]}`]) {
    const samples = [];
    for (let n = 0; n < 21; n++) {
      const start = performance.now(); const response = await mf.dispatchFetch(base + path, { headers }); await response.arrayBuffer();
      if (n) samples.push(performance.now() - start);
    }
    results.api[path.replace(treeShortId, "TREE").replace(ids[0], "PERSON")] = { medianMs: median(samples), p95Ms: [...samples].sort((a,b) => a-b)[18] };
  }
  const currentPhoto = await mf.dispatchFetch(`${base}/api/photos/${ids[0]}`, { headers });
  const conditional = await mf.dispatchFetch(`${base}/api/photos/${ids[0]}`, { headers: { ...headers, "if-none-match": currentPhoto.headers.get("etag") || '"not-available"' } });
  results.photoRevalidation = { status: conditional.status, bodyBytes: (await conditional.arrayBuffer()).byteLength };
  const page = await mf.dispatchFetch(`${base}/t/${treeShortId}`, { headers });
  const html = await page.text(); results.html = { bytes: Buffer.byteLength(html), gzipBytes: gzipSync(html).length };
  browser("open", "about:blank");
  ws = new WebSocket(browser("get", "cdp-url"));
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0; const pending = new Map();
  ws.onmessage = ({ data }) => { const message = JSON.parse(data); const item = pending.get(message.id); if (item) { pending.delete(message.id); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result); } };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...sessionId ? { sessionId } : {} })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  await cdp("Page.enable"); await cdp("Network.enable");
  await cdp("Network.setCookie", { name: cookie.split("=")[0], value: cookie.split("=")[1], url: base, path: "/family-tree" });
  await cdp("Network.emulateNetworkConditions", { offline: false, latency: 100, downloadThroughput: 200000, uploadThroughput: 100000 });
  await cdp("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `window.bench={};new MutationObserver(()=>{if(!bench.graph&&document.querySelector('.person'))bench.graph=performance.now();if(!bench.profile&&document.querySelector('#card:not(.waiting) .who'))bench.profile=performance.now();const img=document.querySelector('#card .photo img');if(!bench.photo&&img?.complete&&img.naturalWidth)bench.photo=performance.now()}).observe(document,{subtree:true,childList:true,attributes:true});setInterval(()=>{const img=document.querySelector('#card .photo img');if(!bench.photo&&img?.complete&&img.naturalWidth)bench.photo=performance.now()},10);` });
  const evaluate = async expression => (await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  for (const kind of ["cold", "warm"]) results.browser[kind] = [];
  for (let run = 0; run < 5; run++) for (const kind of ["cold", "warm"]) {
    await cdp("Page.navigate", { url: "about:blank" });
    while (await evaluate("location.href") !== "about:blank") await new Promise(resolve => setTimeout(resolve, 10));
    if (kind === "cold") await cdp("Network.clearBrowserCache");
    await cdp("Page.navigate", { url: `${base}/t/${treeShortId}#${personShortId}` });
    const deadline = Date.now() + 30000;
    let value;
    do {
      await new Promise(resolve => setTimeout(resolve, 100));
      value = await evaluate(`window.bench?.photo && bench.profile && Array.from(document.images).every(i=>i.complete) ? {...bench,resources:performance.getEntriesByType('resource').map(r=>({name:new URL(r.name).pathname,start:r.startTime,duration:r.duration,bytes:r.transferSize})),navigation:performance.getEntriesByType('navigation')[0].transferSize}:null`);
    } while (!value && Date.now() < deadline);
    if (!value) throw new Error("Timed out waiting for graph, selected profile and photo: " + JSON.stringify(await evaluate("({bench:window.bench,graph:document.querySelectorAll(\".person\").length})")));
    value.selectMs = await evaluate(`(async()=>{const start=performance.now();document.querySelector('.person[data-id="${ids.at(-1)}"]').click();while(document.querySelector('#card')?.classList.contains('waiting'))await new Promise(resolve=>setTimeout(resolve,10));return performance.now()-start})()`);
    results.browser[kind].push(value);
  }
  for (const kind of ["cold", "warm"]) {
    const samples = results.browser[kind];
    results.browser[kind] = { selectMs: median(samples.map(s=>s.selectMs)), graphMs: median(samples.map(s=>s.graph)), profileMs: median(samples.map(s=>s.profile)), photoMs: median(samples.map(s=>s.photo)), transferBytes: median(samples.map(s=>s.navigation+s.resources.filter(r=>r.name.startsWith('/family-tree/')).reduce((n,r)=>n+r.bytes,0))), apiRequests: samples[0].resources.filter(r=>r.name.includes('/api/')).length, samples };
  }
  const editStart = performance.now();
  const contenders = await Promise.all(Array.from({ length: 12 }, (_, i) => mf.dispatchFetch(`${base}/api/people/${ids[0]}`, { method: "PATCH", headers: { origin, authorization: "Bearer local-test-owner-token", "content-type": "application/json" }, body: JSON.stringify({ revision: 0, fields: { name: `Edited relative ${i}` } }) })));
  results.concurrentEdits = { elapsedMs: performance.now()-editStart, success: contenders.filter(r=>r.status===200).length, conflicts: contenders.filter(r=>r.status===409).length };
  const output = resolve(process.argv[3] || new URL("../../.preview/performance/latest.json", import.meta.url).pathname);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ...results, browser: Object.fromEntries(Object.entries(results.browser).map(([k,{ samples, ...v }])=>[k,v])) }, null, 2));
} finally { ws?.close(); try { browser("close"); } catch {} await mf.dispose(); }
