import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { config } from "./config.js";

// IPv4 rules also match IPv4-mapped IPv6 addresses (::ffff:10.0.0.1), so no separate rule for those
const PRIVATE = new BlockList();
const RANGES: [string, number, "ipv4" | "ipv6"][] = [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"], // includes the cloud metadata endpoint
  ["172.16.0.0", 12, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
];
for (const [net, prefix, type] of RANGES) PRIVATE.addSubnet(net, prefix, type);

// Stops an upstream URL from pointing the gateway at cluster internals or cloud metadata.
// The platform's own MCP services are the only private hosts allowed.
export async function checkUpstreamUrl(url: string) {
  const { hostname } = new URL(url);
  if (config.internalHosts.has(hostname)) return;
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  for (const { address, family } of addresses) {
    if (PRIVATE.check(address, family === 6 ? "ipv6" : "ipv4")) {
      throw new Error(`${hostname} points to a private address (${address}), which is not allowed for upstream servers`);
    }
  }
}
