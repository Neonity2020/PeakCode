// FILE: computerUseHelper.test.ts
// Purpose: Holds the install path to the one property the whole design rests on — a helper that
//          is already current is never touched, because touching it costs the user their grant.
// Layer: Desktop computer-use lifecycle tests
//
// These run the real installer against a temp directory and a real `codesign`, because that is
// what decides whether macOS keeps treating the helper as the app the grant was given to. A
// stub would test the stub.
//
// The one thing they do not do is start a helper: `open -a` would launch an app on the machine
// running the tests, which is why the assertions are on `ensureInstalledHelper` rather than on
// `ensureComputerUseHelper`.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  COMPUTER_USE_HELPER_APP_NAME,
  PEAKCODE_COMPUTER_USE_BUNDLED_HELPER_ENV,
} from "@peakcode/shared/computerUse";
import {
  HELPER_SIGNING_IDENTIFIER,
  helperDesignatedRequirement,
  helperExecutablePath,
  signHelperBundle,
  writeHelperInfoPlist,
  type SigningPlan,
} from "@peakcode/shared/computerUseHelperBuild";

import { ensureInstalledHelper, resolveBundledHelperPath } from "./computerUseHelper.ts";

const isMac = process.platform === "darwin";
const hasClang = isMac && spawnSync("clang", ["--version"], { encoding: "utf8" }).status === 0;

/** Ad-hoc on purpose: the tests must not depend on which identities the machine has. */
const AD_HOC: SigningPlan = { identity: null, attachRequirement: true, label: "ad-hoc" };

/** What the packaging step's `codesign --deep` leaves behind: a valid signature whose
 *  requirement is a hash of that exact binary. */
const PACKAGED: SigningPlan = { identity: null, attachRequirement: false, label: "packaging" };

const workspaces: string[] = [];

function workspace(): { directory: string; shippedRoot: string } {
  const directory = mkdtempSync(join(tmpdir(), "peakcode-cua-install-"));
  const shippedRoot = mkdtempSync(join(tmpdir(), "peakcode-cua-shipped-"));
  workspaces.push(directory, shippedRoot);
  return { directory, shippedRoot };
}

/** A helper bundle standing in for the one a packaged app ships. */
function writeShippedBundle(root: string, executableBytes: string): string {
  const bundlePath = join(root, COMPUTER_USE_HELPER_APP_NAME);
  mkdirSync(join(bundlePath, "Contents", "MacOS"), { recursive: true });
  writeHelperInfoPlist(bundlePath);
  writeFileSync(helperExecutablePath(bundlePath), executableBytes, { mode: 0o755 });
  return bundlePath;
}

function installOptions(directory: string, shippedBundlePath: string | null) {
  return {
    directory,
    sourcePath: null,
    bundledHelperPath: shippedBundlePath,
    plan: AD_HOC,
  } as const;
}

function installedExecutable(directory: string): string {
  return helperExecutablePath(join(directory, COMPUTER_USE_HELPER_APP_NAME));
}

function readMetadata(directory: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(directory, ".helper-build.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

afterEach(() => {
  for (const directory of workspaces.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe.skipIf(!isMac)("computer-use helper installation", () => {
  it("installs the shipped helper when there is no source to compile", () => {
    const { directory, shippedRoot } = workspace();
    const shipped = writeShippedBundle(shippedRoot, "shipped-helper");

    const result = ensureInstalledHelper(installOptions(directory, shipped));

    expect(result).toMatchObject({ installed: true, rebuilt: true, source: "bundled" });
    expect(readFileSync(installedExecutable(directory), "utf8")).toBe("shipped-helper");
    expect(statSync(installedExecutable(directory)).mode & 0o100).toBeTruthy();
    expect(readMetadata(directory)).toMatchObject({
      source: "bundled",
      identifier: HELPER_SIGNING_IDENTIFIER,
      signingIdentity: "ad-hoc",
    });
  });

  it("leaves an install that is already current completely untouched", () => {
    const { directory, shippedRoot } = workspace();
    const shipped = writeShippedBundle(shippedRoot, "shipped-helper");
    ensureInstalledHelper(installOptions(directory, shipped));
    const before = statSync(installedExecutable(directory));

    const second = ensureInstalledHelper(installOptions(directory, shipped));

    expect(second).toMatchObject({ installed: true, rebuilt: false, source: "bundled" });
    // Same inode, same mtime: the bundle on disk was not rewritten. This is the property the
    // Accessibility grant depends on — a bundle that changes is a bundle the grant no longer
    // matches.
    const after = statSync(installedExecutable(directory));
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(readFileSync(installedExecutable(directory), "utf8")).toBe("shipped-helper");
  });

  it("installs a new version when the shipped helper changes", () => {
    const { directory, shippedRoot } = workspace();
    const shipped = writeShippedBundle(shippedRoot, "version-1");
    ensureInstalledHelper(installOptions(directory, shipped));

    writeFileSync(helperExecutablePath(shipped), "version-2", { mode: 0o755 });
    const result = ensureInstalledHelper(installOptions(directory, shipped));

    expect(result).toMatchObject({ installed: true, rebuilt: true });
    expect(readFileSync(installedExecutable(directory), "utf8")).toBe("version-2");
  });

  it("gives a shipped helper the requirement the packaging step cannot preserve", () => {
    const { directory, shippedRoot } = workspace();
    const shipped = writeShippedBundle(shippedRoot, "shipped-helper");
    // Exactly what `codesign --deep` does to a nested app in an unsigned build.
    expect(signHelperBundle(shipped, PACKAGED).ok).toBe(true);
    expect(helperDesignatedRequirement(shipped)).toMatch(/^cdhash /);

    ensureInstalledHelper(installOptions(directory, shipped));

    // The installed copy carries the identifier requirement, so the grant the user gives it
    // survives the next app update instead of dying with the hash.
    const installed = join(directory, COMPUTER_USE_HELPER_APP_NAME);
    expect(helperDesignatedRequirement(installed)).toBe(
      `identifier "${HELPER_SIGNING_IDENTIFIER}"`,
    );
  });

  it("does not reinstall after re-signing the copy it just installed", () => {
    // The installed bytes differ from the shipped ones once re-signing happened, so the
    // fingerprint has to be taken from the shipped artifact — otherwise every start would
    // rebuild the helper and the grant would never settle.
    const { directory, shippedRoot } = workspace();
    const shipped = writeShippedBundle(shippedRoot, "shipped-helper");
    signHelperBundle(shipped, PACKAGED);
    ensureInstalledHelper(installOptions(directory, shipped));

    const second = ensureInstalledHelper(installOptions(directory, shipped));

    expect(second).toMatchObject({ installed: true, rebuilt: false });
  });

  it("reports that there is nothing to install from", () => {
    const { directory } = workspace();

    const result = ensureInstalledHelper({ directory, sourcePath: null, bundledHelperPath: null });

    expect(result.installed).toBe(false);
    expect(result.detail).toMatch(/neither the native source nor a bundled copy/);
  });

  it("accepts an existing install when the build has nothing to install from", () => {
    // A packaged build with no shipped helper still leaves a working machine working: the
    // installed helper is the one the user's grant is filed against.
    const { directory, shippedRoot } = workspace();
    ensureInstalledHelper(installOptions(directory, writeShippedBundle(shippedRoot, "installed")));

    const result = ensureInstalledHelper({
      directory,
      sourcePath: null,
      bundledHelperPath: null,
    });

    expect(result).toMatchObject({ installed: true, rebuilt: false });
  });

  it("reinstalls when the metadata is current but the bundle is gone", () => {
    const { directory, shippedRoot } = workspace();
    const shipped = writeShippedBundle(shippedRoot, "shipped-helper");
    ensureInstalledHelper(installOptions(directory, shipped));
    rmSync(join(directory, COMPUTER_USE_HELPER_APP_NAME), { recursive: true, force: true });

    const result = ensureInstalledHelper(installOptions(directory, shipped));

    expect(result).toMatchObject({ installed: true, rebuilt: true });
    expect(existsSync(installedExecutable(directory))).toBe(true);
  });

  it.skipIf(!hasClang)("compiles from source, and prefers the source over a shipped copy", () => {
    const { directory, shippedRoot } = workspace();
    const sourcePath = join(shippedRoot, "main.m");
    writeFileSync(sourcePath, "int main(void) { return 0; }\n");

    const result = ensureInstalledHelper({
      directory,
      sourcePath,
      bundledHelperPath: writeShippedBundle(shippedRoot, "shipped-helper"),
      plan: AD_HOC,
    });

    expect(result).toMatchObject({ installed: true, rebuilt: true, source: "compiled" });
    expect(readMetadata(directory)).toMatchObject({ source: "compiled" });
    // A real Mach-O binary, not the fake bytes the bundle path would have copied.
    expect(readFileSync(installedExecutable(directory)).subarray(0, 4).toString("hex")).toBe(
      "cffaedfe",
    );
  });

  it.skipIf(!hasClang)("leaves a source-built install alone on the next start", () => {
    const { directory, shippedRoot } = workspace();
    const sourcePath = join(shippedRoot, "main.m");
    writeFileSync(sourcePath, "int main(void) { return 0; }\n");
    const options = { directory, sourcePath, bundledHelperPath: null, plan: AD_HOC };
    ensureInstalledHelper(options);
    const before = statSync(installedExecutable(directory));

    const second = ensureInstalledHelper(options);

    expect(second).toMatchObject({ installed: true, rebuilt: false, source: "compiled" });
    expect(statSync(installedExecutable(directory)).ino).toBe(before.ino);
  });
});

describe("bundled helper discovery", () => {
  it("uses an explicit path when one is set", () => {
    const root = mkdtempSync(join(tmpdir(), "peakcode-cua-discovery-"));
    workspaces.push(root);
    const shipped = writeShippedBundle(root, "shipped-helper");

    expect(resolveBundledHelperPath({ [PEAKCODE_COMPUTER_USE_BUNDLED_HELPER_ENV]: shipped })).toBe(
      shipped,
    );
  });

  it("ignores a path that is not there", () => {
    expect(
      resolveBundledHelperPath({
        [PEAKCODE_COMPUTER_USE_BUNDLED_HELPER_ENV]: "/tmp/peakcode-not-a-helper.app",
      }),
    ).toBeNull();
  });

  it("finds nothing outside a packaged app", () => {
    // Under plain Node — which is where the tests and the server run — there is no
    // `resourcesPath`, so there is no bundle to find.
    expect(resolveBundledHelperPath({})).toBeNull();
  });
});
