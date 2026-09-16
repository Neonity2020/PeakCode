import { assert, describe, it } from "@effect/vitest";

import { resolveCatalogDependencies, stripWorkspaceDependencies } from "./lib/resolve-catalog.ts";

describe("resolveCatalogDependencies", () => {
  it("replaces catalog specs with their concrete versions", () => {
    assert.deepStrictEqual(
      resolveCatalogDependencies(
        { effect: "catalog:", vitest: "catalog:testing", ws: "^8.18.0" },
        { effect: "1.0.0", testing: "4.0.0" },
        "apps/server",
      ),
      { effect: "1.0.0", vitest: "4.0.0", ws: "^8.18.0" },
    );
  });

  it("throws when the catalog has no matching entry", () => {
    assert.throws(
      () => resolveCatalogDependencies({ effect: "catalog:" }, {}, "apps/server"),
      /Unable to resolve 'catalog:' for apps\/server dependency 'effect'/,
    );
  });
});

describe("stripWorkspaceDependencies", () => {
  it("drops workspace specs and reports what was removed", () => {
    const { dependencies, dropped } = stripWorkspaceDependencies({
      "@peakcode/agent-toolkit": "workspace:*",
      ws: "^8.18.0",
      effect: "catalog:",
    });

    assert.deepStrictEqual(dependencies, { ws: "^8.18.0", effect: "catalog:" });
    assert.deepStrictEqual(dropped, ["@peakcode/agent-toolkit"]);
  });

  it("keeps non-string specs untouched", () => {
    const { dependencies, dropped } = stripWorkspaceDependencies({
      "weird-spec": null,
      "file-dep": "file:../local",
    });

    assert.deepStrictEqual(dependencies, { "weird-spec": null, "file-dep": "file:../local" });
    assert.deepStrictEqual(dropped, []);
  });
});
