import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  installPiPackage,
  listPiPackages,
  piPackageSourceKind,
  piPackagesAgentDir,
  removePiPackage,
} from "./piPackages";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/**
 * A minimal pi package: manifest resources plus the conventional skill directory, which is
 * all `DefaultPackageManager` needs to resolve real resources from a local source.
 */
async function makeFixturePackage(root: string): Promise<string> {
  const pkgDir = join(root, "fixture-pkg");
  await mkdir(join(pkgDir, "skills", "fixture-skill"), { recursive: true });
  await mkdir(join(pkgDir, "prompts"), { recursive: true });
  await writeFile(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: "fixture-pkg",
      version: "1.0.0",
      keywords: ["pi-package"],
      pi: { skills: ["./skills"], prompts: ["./prompts"] },
    }),
  );
  await writeFile(
    join(pkgDir, "skills", "fixture-skill", "SKILL.md"),
    "---\nname: fixture-skill\ndescription: Fixture skill.\n---\n\nDo fixture things.\n",
  );
  await writeFile(join(pkgDir, "prompts", "fixture-prompt.md"), "Fixture prompt.\n");
  return pkgDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("piPackageSourceKind", () => {
  it("classifies the source forms pi install accepts", () => {
    expect(piPackageSourceKind("npm:@melihmucuk/pi-crew")).toBe("npm");
    expect(piPackageSourceKind("npm:pkg@1.2.3")).toBe("npm");
    expect(piPackageSourceKind("git:github.com/melihmucuk/pi-crew")).toBe("git");
    expect(piPackageSourceKind("git:git@github.com:melihmucuk/pi-crew@v1")).toBe("git");
    expect(piPackageSourceKind("https://github.com/melihmucuk/pi-crew")).toBe("git");
    expect(piPackageSourceKind("ssh://git@github.com/melihmucuk/pi-crew")).toBe("git");
    expect(piPackageSourceKind("./local/package")).toBe("local");
    expect(piPackageSourceKind("/absolute/package")).toBe("local");
  });
});

describe("piPackagesAgentDir", () => {
  it("falls back to the pi agent dir the SDK itself would use", () => {
    expect(piPackagesAgentDir(undefined)).toBe(getAgentDir());
    expect(piPackagesAgentDir("   ")).toBe(getAgentDir());
    expect(piPackagesAgentDir(" /custom/agent ")).toBe("/custom/agent");
  });
});

describe("pi package listing", () => {
  it("reports an empty listing for a directory with no packages", async () => {
    const agentDir = await makeTempDir("peakcode-pipkg-");
    const snapshot = await Effect.runPromise(listPiPackages(agentDir));
    expect(snapshot).toEqual({
      agentDir,
      settingsPath: join(agentDir, "settings.json"),
      packages: [],
    });
  });

  it("installs a local package, reports its resources, then removes it", async () => {
    const root = await makeTempDir("peakcode-pipkg-");
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    const pkgDir = await makeFixturePackage(root);

    const installed = await Effect.runPromise(installPiPackage({ agentDir, source: pkgDir }));
    const [entry] = installed.packages;
    expect(installed.packages).toHaveLength(1);
    expect(entry?.kind).toBe("local");
    expect(entry?.scope).toBe("user");
    expect(entry?.filtered).toBe(false);
    expect(entry?.resources).toEqual({ extensions: 0, skills: 1, prompts: 1, themes: 0 });
    expect(entry?.installedPath).toBe(pkgDir);

    // The source must land in the file `pi install`/`pi remove` read, or the next session
    // would not see the package. Local paths are stored relative to that file.
    const settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as {
      packages?: string[];
    };
    expect(settings.packages).toEqual(["../fixture-pkg"]);

    const listed = await Effect.runPromise(listPiPackages(agentDir));
    expect(listed.packages.map((pkg) => pkg.source)).toEqual(["../fixture-pkg"]);

    // The GUI removes what the listing returned, not what the user originally typed.
    const removed = await Effect.runPromise(
      removePiPackage({ agentDir, source: listed.packages[0]!.source }),
    );
    expect(removed.packages).toEqual([]);
    expect(JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"))).toEqual({
      packages: [],
    });
  });

  it("does not install sources that are merely configured", async () => {
    const agentDir = await makeTempDir("peakcode-pipkg-");
    // A source with no local checkout and no network reach would fail an implicit install;
    // listing must stay read-only and simply report it as not installed.
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ packages: ["git:github.com/example/not-cloned"] }),
    );
    const snapshot = await Effect.runPromise(listPiPackages(agentDir));
    expect(snapshot.packages).toHaveLength(1);
    expect(snapshot.packages[0]?.installedPath).toBeUndefined();
    expect(snapshot.packages[0]?.resources).toEqual({
      extensions: 0,
      skills: 0,
      prompts: 0,
      themes: 0,
    });
  });

  it("surfaces install failures instead of reporting success", async () => {
    const agentDir = await makeTempDir("peakcode-pipkg-");
    const failure = await Effect.runPromise(
      Effect.flip(installPiPackage({ agentDir, source: "/definitely/not/a/package" })),
    );
    expect(failure.message).toContain("Failed to install");
    expect(failure.message).toContain("/definitely/not/a/package");
  });
});
