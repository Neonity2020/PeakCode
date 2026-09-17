import { describe, expect, it } from "vitest";

import { resolveWebEntryFilePath } from "./webEntryPaths";

describe("resolveWebEntryFilePath", () => {
  it("serves the phone page on its short route, with or without a trailing slash", () => {
    expect(resolveWebEntryFilePath("/h5")).toBe("/mobile.html");
    expect(resolveWebEntryFilePath("/h5/")).toBe("/mobile.html");
  });

  it("leaves the desktop app and ordinary assets to the normal resolution", () => {
    expect(resolveWebEntryFilePath("/")).toBeNull();
    expect(resolveWebEntryFilePath("/settings")).toBeNull();
    expect(resolveWebEntryFilePath("/assets/index-abc123.js")).toBeNull();
    // The phone page is reachable by file name too, which is what a dev server serves.
    expect(resolveWebEntryFilePath("/mobile.html")).toBe("/mobile.html");
  });
});
