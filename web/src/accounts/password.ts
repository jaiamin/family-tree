import { assert } from "../model";

const iterations = 600_000;
const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer as ArrayBuffer)].map(b => b.toString(16).padStart(2, "0")).join("");
const unhex = (value: string) => Uint8Array.from(value.match(/../g) || [], byte => parseInt(byte, 16));
export function validatePassword(password: unknown): asserts password is string {
  assert(typeof password === "string" && password.length >= 12 && password.length <= 200, "Use a password of 12–200 characters.");
}
async function derive(password: string, salt: Uint8Array, rounds: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, key, 256));
}
export async function hashPassword(password: string) {
  validatePassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${iterations}$${hex(salt)}$${hex(await derive(password, salt, iterations))}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, rounds, salt, expected] = encoded.split("$");
  if (algorithm !== "pbkdf2-sha256" || Number(rounds) !== iterations || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  const actual = await derive(password, unhex(salt), iterations);
  const target = unhex(expected);
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ target[i];
  return difference === 0;
}
