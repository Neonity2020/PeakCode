import { describe, expect, it } from "vitest";

import { extractTunnelUrl, tunnelOutputTail } from "./cloudflare.ts";

/** cloudflared's quick-tunnel banner, as it appears on stderr. */
const QUICK_TUNNEL_OUTPUT = [
  "2026-09-17T19:00:00Z INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment.",
  "2026-09-17T19:00:01Z INF +--------------------------------------------------------------------------------------------+",
  "2026-09-17T19:00:01Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |",
  "2026-09-17T19:00:01Z INF |  https://silly-panda-loves-coding.trycloudflare.com                                        |",
  "2026-09-17T19:00:01Z INF +--------------------------------------------------------------------------------------------+",
].join("\n");

describe("extractTunnelUrl", () => {
  it("finds the quick-tunnel address in cloudflared's banner", () => {
    expect(extractTunnelUrl(QUICK_TUNNEL_OUTPUT)).toBe(
      "https://silly-panda-loves-coding.trycloudflare.com",
    );
  });

  it("finds an address that arrives without any banner around it", () => {
    expect(extractTunnelUrl("your url is https://a-b-c.trycloudflare.com ok")).toBe(
      "https://a-b-c.trycloudflare.com",
    );
  });

  it("does not mistake the docs link or an unrelated host for the tunnel", () => {
    expect(extractTunnelUrl("see https://developers.cloudflare.com for details")).toBeNull();
    expect(extractTunnelUrl("requesting new quick Tunnel on trycloudflare.com...")).toBeNull();
    expect(extractTunnelUrl("")).toBeNull();
  });

  it("ignores a host that only mentions trycloudflare inside another domain", () => {
    expect(extractTunnelUrl("https://evil.test/?x=trycloudflare.com")).toBeNull();
  });
});

describe("tunnelOutputTail", () => {
  it("keeps the last non-empty lines, so a failure message carries the reason", () => {
    const output = ["line1", "", "line2", "  ", "line3", "line4", "line5", "line6", "line7"].join(
      "\n",
    );
    const tail = tunnelOutputTail(output);
    expect(tail.split("\n")).toEqual(["line2", "line3", "line4", "line5", "line6", "line7"]);
  });
});
