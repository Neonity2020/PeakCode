import { assert, describe, it } from "@effect/vitest";

import {
  UPSTREAM_SOURCE,
  gitHead,
  resolveOhMyPiSource,
  upstreamAttribution,
} from "./lib/oh-my-pi-source.ts";

describe("resolveOhMyPiSource", () => {
  it("resolves the --source path", () => {
    assert.strictEqual(resolveOhMyPiSource(["--source", "/tmp/oh-my-pi"]), "/tmp/oh-my-pi");
  });

  it("lets a later --source win, so a wrapper can override a default", () => {
    assert.strictEqual(
      resolveOhMyPiSource(["--source", "/nonexistent", "--source", "/tmp/oh-my-pi"]),
      "/tmp/oh-my-pi",
    );
  });

  it("throws when --source is missing or has no value", () => {
    const message = /missing --source <path to an oh-my-pi checkout>/;
    assert.throws(() => resolveOhMyPiSource([]), message);
    assert.throws(() => resolveOhMyPiSource(["--source"]), message);
    assert.throws(() => resolveOhMyPiSource(["--source", ""]), message);
  });
});

describe("gitHead", () => {
  it("reads the upstream commit from a checkout", () => {
    assert.match(gitHead(import.meta.dirname), /^[0-9a-f]{40}$/);
  });

  it("falls back to 'unknown' when the path is not a git checkout", () => {
    // The header must still render for content copied out of a tarball.
    assert.strictEqual(gitHead("/nonexistent-oh-my-pi-checkout"), "unknown");
  });
});

describe("upstreamAttribution", () => {
  it("carries the source, the commit and the license", () => {
    const line = upstreamAttribution("abc123");
    assert.include(line, UPSTREAM_SOURCE);
    assert.include(line, "abc123");
    assert.include(line, "MIT");
  });
});
