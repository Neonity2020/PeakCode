import { describe, expect, it } from "vitest";

import { corsOriginFor } from "./http.ts";

describe("corsOriginFor", () => {
  it("allows the dev desktop window, which is served by the Vite dev server", () => {
    // The exact origin seen in a running desktop dev instance's console.
    expect(corsOriginFor("http://localhost:8933")).toBe("http://localhost:8933");
    expect(corsOriginFor("http://127.0.0.1:5733")).toBe("http://127.0.0.1:5733");
    expect(corsOriginFor("http://[::1]:5733")).toBe("http://[::1]:5733");
  });

  it("allows the packaged shell's own scheme", () => {
    expect(corsOriginFor("t3://app")).toBe("t3://app");
  });

  it("refuses public and LAN origins, so a website cannot read local responses", () => {
    expect(corsOriginFor("https://evil.example")).toBeNull();
    expect(corsOriginFor("http://192.168.1.5:8080")).toBeNull();
    expect(corsOriginFor("https://random-words.trycloudflare.com")).toBeNull();
  });

  it("refuses opaque and malformed origins", () => {
    expect(corsOriginFor(undefined)).toBeNull();
    expect(corsOriginFor("")).toBeNull();
    expect(corsOriginFor("null")).toBeNull();
    expect(corsOriginFor("not a url")).toBeNull();
  });
});
