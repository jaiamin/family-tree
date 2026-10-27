import { assert, HttpError, record } from "./model";
export async function limitedBody(request: Request, max = 1_500_000) {
  assert(request.body, "Request body is required.");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new HttpError(413, "This upload is too large."); }
    chunks.push(value);
  }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return data;
}
export async function bodyOf(request: Request) {
  assert(request.headers.get("content-type")?.includes("application/json"), "Send JSON.", 415);
  try {
    const body = JSON.parse(new TextDecoder().decode(await limitedBody(request)));
    assert(record(body), "Send a JSON object.");
    return body;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid JSON.");
  }
}
export function text(value: unknown, max: number, required = false): string {
  assert(typeof value === "string" && value.trim().length <= max && (!required || value.trim().length > 0), "Please complete the form within the stated limits.");
  return value.trim();
}
