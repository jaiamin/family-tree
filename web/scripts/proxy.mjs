import { isIP } from "node:net";

export function proxyHops(value = "0") {
  if (!/^[0-9]$/.test(value)) throw Error("TRUST_PROXY_HOPS must be an integer from 0 to 9.");
  return Number(value);
}

// Trust only the configured number of proxies nearest the server. The public
// proxy must overwrite/append the actual peer address, and direct access must
// remain blocked. Never use the leftmost, client-controlled address blindly.
export function clientAddress(peer, forwarded, hops = 0) {
  const fallback = peer || "unknown";
  if (!hops || typeof forwarded !== "string") return fallback;
  const addresses = forwarded.split(",").map(address => address.trim());
  if (addresses.length < hops || addresses.some(address => !isIP(address))) return fallback;
  return addresses.at(-hops);
}
