import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  COMPUTER_USE_HELPER_APP_NAME,
  COMPUTER_USE_HELPER_BUNDLE_ID,
  COMPUTER_USE_HELPER_DISPLAY_NAME,
  COMPUTER_USE_PROTOCOL_VERSION,
} from "./computerUse";
import {
  HELPER_ADHOC_REQUIREMENT,
  SIGNING_IDENTITY_ENV,
  helperBundleFingerprint,
  helperExecutablePath,
  helperSourceFingerprint,
  isAnchoredRequirement,
  parseDesignatedRequirement,
  resolveSigningPlan,
  writeHelperInfoPlist,
  type SigningPlan,
} from "./computerUseHelperBuild";

const AD_HOC: SigningPlan = { identity: null, attachRequirement: true, label: "ad-hoc" };
const DEVELOPER_ID: SigningPlan = {
  identity: "Developer ID Application: Peak Code (ABCDE12345)",
  attachRequirement: false,
  label: "Developer ID Application: Peak Code (ABCDE12345)",
};

const workspaces: string[] = [];

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "peakcode-helper-build-test-"));
  workspaces.push(directory);
  return directory;
}

/** A helper bundle on disk, without invoking clang or codesign. */
function writeBundle(root: string, executableBytes: string, plistExtra = ""): string {
  const bundlePath = join(root, COMPUTER_USE_HELPER_APP_NAME);
  mkdirSync(join(bundlePath, "Contents", "MacOS"), { recursive: true });
  writeHelperInfoPlist(bundlePath);
  if (plistExtra) {
    writeFileSync(join(bundlePath, "Contents", "Info.plist"), plistExtra);
  }
  writeFileSync(helperExecutablePath(bundlePath), executableBytes, { mode: 0o755 });
  return bundlePath;
}

afterEach(() => {
  for (const directory of workspaces.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("the ad-hoc requirement", () => {
  it("names the identifier rather than hashing the binary", () => {
    // This is the line that keeps the user's grant alive across rebuilds. A `cdhash`
    // requirement would be satisfied only by the exact bytes codesign saw, so every rebuild of
    // the helper would cost the user their Accessibility grant.
    expect(HELPER_ADHOC_REQUIREMENT).toBe(
      `=designated => identifier "${COMPUTER_USE_HELPER_BUNDLE_ID}"`,
    );
  });
});

describe("parseDesignatedRequirement", () => {
  // Verbatim `codesign --display --requirements -` output from this machine, one bundle per
  // shape. The reports are part of the record here: the leading `#` is the difference between
  // "keep this signature" and "replace it", and it is invisible in a hand-written fixture.
  it("reads an explicitly signed requirement", () => {
    expect(parseDesignatedRequirement('designated => identifier "com.peakcode.cua-helper"\n')).toBe(
      'identifier "com.peakcode.cua-helper"',
    );
  });

  it("reads a requirement codesign printed commented out", () => {
    // An implicit requirement — what `codesign --sign -` with no `--requirements` writes, and
    // what a certificate writes — arrives behind a `#`.
    expect(
      parseDesignatedRequirement(
        'host => identifier "com.apple.sh" and anchor apple\n' +
          '# designated => cdhash H"61a41afcc8a0866959ed63f4316b4f0a2bcc1879"\n',
      ),
    ).toBe('cdhash H"61a41afcc8a0866959ed63f4316b4f0a2bcc1879"');
  });

  it("reads a team-anchored requirement, which is the one that must be kept", () => {
    expect(
      parseDesignatedRequirement(
        "Executable=…\n" +
          '# designated => identifier "com.microsoft.VSCode" and anchor apple generic and ' +
          "certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate " +
          "leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate " +
          'leaf[subject.OU] = "UBF8T346G9"\n',
      ),
    ).toMatch(/anchor apple generic/);
  });

  it("reports nothing when the report has no requirement at all", () => {
    expect(parseDesignatedRequirement("Executable=/tmp/whatever\n")).toBeNull();
    expect(parseDesignatedRequirement("")).toBeNull();
  });
});

describe("isAnchoredRequirement", () => {
  it("treats a missing requirement as unanchored", () => {
    expect(isAnchoredRequirement(null)).toBe(false);
  });

  it("treats an ad-hoc requirement as unanchored, whether it names the id or the hash", () => {
    expect(isAnchoredRequirement(`identifier "${COMPUTER_USE_HELPER_BUNDLE_ID}"`)).toBe(false);
    expect(isAnchoredRequirement('cdhash H"5a1273f72f3c629b0aef8b0bf1fd7c44b6e56c6a"')).toBe(false);
  });

  it("recognises the requirements a certificate produces", () => {
    // The shapes measured in .docs/computer-use.md, trimmed to their parts.
    expect(
      isAnchoredRequirement(
        `identifier "${COMPUTER_USE_HELPER_BUNDLE_ID}" and anchor apple generic and ` +
          'certificate leaf[subject.CN] = "Apple Development: name (CERTID)"',
      ),
    ).toBe(true);
    expect(
      isAnchoredRequirement(
        `identifier "${COMPUTER_USE_HELPER_BUNDLE_ID}" and anchor apple generic and ` +
          "certificate leaf[field.1.2.840.113635.100.6.1.13] and certificate " +
          'leaf[subject.OU] = "TEAMID"',
      ),
    ).toBe(true);
  });

  it("recognises Apple's own anchor, which is stronger still", () => {
    expect(isAnchoredRequirement('identifier "com.apple.calculator" and anchor apple')).toBe(true);
  });
});

describe("resolveSigningPlan", () => {
  it("uses an explicitly named identity as it is", () => {
    const plan = resolveSigningPlan({
      [SIGNING_IDENTITY_ENV]: "Developer ID Application: Peak Code (ABCDE12345)",
    });

    expect(plan.identity).toBe("Developer ID Application: Peak Code (ABCDE12345)");
    // Never combined with `--requirements`: that flag would replace the anchored requirement
    // the certificate produced with an identifier-only one.
    expect(plan.attachRequirement).toBe(false);
  });

  it("ignores a blank override", () => {
    const plan = resolveSigningPlan({ [SIGNING_IDENTITY_ENV]: "   " });
    expect(plan.identity).not.toBe("   ");
  });

  it("attaches the requirement exactly when it falls back to ad-hoc", () => {
    // The invariant, stated without depending on what the keychain happens to hold: an
    // anchored identity keeps its own requirement, and only the ad-hoc fallback needs ours.
    for (const env of [{}, { [SIGNING_IDENTITY_ENV]: "Developer ID Application: Peak (A)" }]) {
      const plan = resolveSigningPlan(env);
      expect(plan.attachRequirement).toBe(plan.identity === null);
    }
  });

  it("does not select an Apple Development certificate on its own", () => {
    // Its requirement pins that one certificate, so it works until the certificate is renewed
    // and then silently costs the user the grant. Only an explicit override may pick it.
    const plan = resolveSigningPlan({});
    expect(plan.identity === null || plan.identity.startsWith("Developer ID Application:")).toBe(
      true,
    );
  });
});

describe("helper bundle layout", () => {
  it("names the executable after the bundle, without the extension", () => {
    expect(helperExecutablePath("/tmp/Peak Code Computer Use.app")).toBe(
      "/tmp/Peak Code Computer Use.app/Contents/MacOS/Peak Code Computer Use",
    );
  });

  it("writes the plist that the grant and the protocol version are tied to", () => {
    const root = workspace();
    const bundlePath = writeBundle(root, "fake");
    const plist = readFileSync(join(bundlePath, "Contents", "Info.plist"), "utf8");

    expect(plist).toContain(`<string>${COMPUTER_USE_HELPER_BUNDLE_ID}</string>`);
    expect(plist).toContain(`<string>${COMPUTER_USE_HELPER_DISPLAY_NAME}</string>`);
    expect(plist).toContain(`<integer>${COMPUTER_USE_PROTOCOL_VERSION}</integer>`);
    // No dock icon and no menu bar: this app exists to hold a grant and serve a socket.
    expect(plist).toContain("<key>LSUIElement</key>\n  <true/>");
  });
});

describe("build fingerprints", () => {
  it("is stable for the same artifact and plan", () => {
    const root = workspace();
    const sourcePath = join(root, "main.m");
    writeFileSync(sourcePath, "int main(void) { return 0; }");

    expect(helperSourceFingerprint(sourcePath, AD_HOC)).toBe(
      helperSourceFingerprint(sourcePath, AD_HOC),
    );
  });

  it("changes when the artifact changes", () => {
    const root = workspace();
    const sourcePath = join(root, "main.m");
    writeFileSync(sourcePath, "int main(void) { return 0; }");
    const before = helperSourceFingerprint(sourcePath, AD_HOC);

    writeFileSync(sourcePath, "int main(void) { return 1; }");
    expect(helperSourceFingerprint(sourcePath, AD_HOC)).not.toBe(before);
  });

  it("changes when the signing plan changes", () => {
    // Switching identity changes the designated requirement, so a helper signed the old way
    // must not be mistaken for current.
    const root = workspace();
    const sourcePath = join(root, "main.m");
    writeFileSync(sourcePath, "int main(void) { return 0; }");

    expect(helperSourceFingerprint(sourcePath, AD_HOC)).not.toBe(
      helperSourceFingerprint(sourcePath, DEVELOPER_ID),
    );
  });

  it("reads a shipped bundle's executable, which is what gets installed", () => {
    const root = workspace();
    const bundlePath = writeBundle(root, "shipped-binary");
    const before = helperBundleFingerprint(bundlePath, AD_HOC);

    // Same executable, different bytes elsewhere in the bundle: nothing to reinstall.
    writeBundle(root, "shipped-binary", "<!-- cosmetic plist change -->");
    expect(helperBundleFingerprint(bundlePath, AD_HOC)).toBe(before);
  });

  it("changes when the shipped helper does, so a new version installs", () => {
    const root = workspace();
    const bundlePath = writeBundle(root, "version-1");
    const before = helperBundleFingerprint(bundlePath, AD_HOC);

    writeFileSync(helperExecutablePath(bundlePath), "version-2", { mode: 0o755 });
    expect(helperBundleFingerprint(bundlePath, AD_HOC)).not.toBe(before);
  });

  it("agrees between the source and bundle paths for identical bytes", () => {
    // Both paths have to feed the same inputs into the same hash, or the same helper arriving
    // from a different source would rebuild an install that was already current — and the
    // rebuild is exactly what costs the user their grant.
    const root = workspace();
    const sourcePath = join(root, "main.m");
    writeFileSync(sourcePath, "identical-bytes");
    const bundlePath = writeBundle(root, "identical-bytes");

    expect(helperBundleFingerprint(bundlePath, AD_HOC)).toBe(
      helperSourceFingerprint(sourcePath, AD_HOC),
    );
  });
});
