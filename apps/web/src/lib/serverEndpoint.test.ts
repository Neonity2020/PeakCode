// FILE: serverEndpoint.test.ts
// Purpose: Pins the origin rules that decide whether this browser talks to an injected dev
//          address or back to the origin it was served from — the difference between a
//          phone that works through a tunnel and one that dials its own localhost.
// Layer: Web utility tests
// Depends on: a stubbed `window` and `import.meta.env.VITE_WS_URL`.

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveServerHttpUrl, resolveServerOrigin, resolveServerWsUrl } from "./serverEndpoint";

function stubWindow(value: object): void {
  Object.defineProperty(globalThis, "window", { configurable: true, value });
}

function stubPage(location: object): void {
  stubWindow({ location, desktopBridge: undefined });
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.unstubAllEnvs();
});

describe("resolveServerWsUrl", () => {
  it("prefers the desktop bridge URL injected by the Electron shell", () => {
    vi.stubEnv("VITE_WS_URL", "ws://[::1]:51623");
    stubWindow({
      location: {
        protocol: "https:",
        hostname: "random-words.trycloudflare.com",
        host: "random-words.trycloudflare.com",
        port: "",
      },
      desktopBridge: { getWsUrl: () => "ws://127.0.0.1:53036/?token=desktop-secret" },
    });

    expect(resolveServerWsUrl()).toBe("ws://127.0.0.1:53036/?token=desktop-secret");
    expect(resolveServerHttpUrl("/api/local-image?path=/tmp/a.png")).toBe(
      "http://127.0.0.1:53036/api/local-image?path=%2Ftmp%2Fa.png&token=desktop-secret",
    );
  });

  it("uses the dev server address on a page served from loopback", () => {
    vi.stubEnv("VITE_WS_URL", "ws://[::1]:51623");
    stubPage({
      protocol: "http:",
      hostname: "localhost",
      host: "localhost:8933",
      port: "8933",
    });

    expect(resolveServerWsUrl()).toBe("ws://[::1]:51623");
    expect(resolveServerOrigin()).toBe("http://[::1]:51623");
  });

  it("ignores the dev server address on a page served from a tunnel host", () => {
    vi.stubEnv("VITE_WS_URL", "ws://[::1]:51623");
    stubPage({
      protocol: "https:",
      hostname: "random-words.trycloudflare.com",
      host: "random-words.trycloudflare.com",
      port: "",
    });

    // The tunnel origin proxies both the app and the API, so it is the only address that
    // resolves from the phone; `[::1]` would be the phone itself.
    expect(resolveServerWsUrl()).toBe("wss://random-words.trycloudflare.com");
    expect(resolveServerOrigin()).toBe("https://random-words.trycloudflare.com");
    expect(resolveServerHttpUrl("/attachments/abc")).toBe(
      "https://random-words.trycloudflare.com/attachments/abc",
    );
  });

  it("falls back to the page origin for a LAN address with no dev address at all", () => {
    stubPage({
      protocol: "http:",
      hostname: "192.168.1.42",
      host: "192.168.1.42:3773",
      port: "3773",
    });

    expect(resolveServerWsUrl()).toBe("ws://192.168.1.42:3773");
    expect(resolveServerHttpUrl("/health")).toBe("http://192.168.1.42:3773/health");
  });
});
