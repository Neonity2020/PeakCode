// FILE: electron-builder-after-pack.cjs
// Purpose: Restores the legacy macOS icon fallback, and ad-hoc signs the bundle when the release has no Developer ID.
// Layer: Build hook
// Depends on: electron-builder's afterPack hook context and macOS plutil and codesign availability.

const { copyFileSync, existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

/** Set by `scripts/build-desktop-artifact.ts` for a macOS build with no Developer ID identity. */
const AD_HOC_SIGN_ENV = "PEAKCODE_MAC_AD_HOC_SIGN";
const COMPUTER_USE_HELPER_DIR = "computer-use";
const COMPUTER_USE_HELPER_APP = "Peak Code Computer Use.app";

function runCodesign(args) {
  const result = spawnSync("codesign", args, { encoding: "utf8" });
  const details = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { status: result.status, unavailable: Boolean(result.error), details };
}

function requireCodesign(args, what) {
  const result = runCodesign(args);
  if (result.status === 0) {
    return;
  }

  const reason = result.unavailable
    ? "codesign is not available"
    : result.details || "unknown error";
  throw new Error(`${what}: ${reason}`);
}

function setPlistString(plistPath, key, value) {
  const replaceResult = spawnSync("plutil", ["-replace", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = spawnSync("plutil", ["-insert", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

function findAppBundle(context) {
  const appOutDir = typeof context?.appOutDir === "string" ? context.appOutDir : "";
  if (!appOutDir) {
    return null;
  }

  const productFilename = context?.packager?.appInfo?.productFilename;
  const preferredBundlePath =
    typeof productFilename === "string" ? join(appOutDir, `${productFilename}.app`) : null;
  if (preferredBundlePath && existsSync(preferredBundlePath)) {
    return preferredBundlePath;
  }

  return (
    readdirSync(appOutDir)
      .filter((entry) => entry.endsWith(".app"))
      .map((entry) => join(appOutDir, entry))[0] ?? null
  );
}

// Keep a classic .icns entry in the app bundle so pre-Tahoe macOS can still resolve the icon.
function restoreLegacyIcon(context, appBundlePath) {
  const appDir = typeof context?.appDir === "string" ? context.appDir : process.cwd();
  const sourceIcnsPath = join(appDir, "apps", "desktop", "resources", "icon.icns");
  if (!existsSync(sourceIcnsPath)) {
    throw new Error(`Missing legacy macOS icon at ${sourceIcnsPath}`);
  }

  copyFileSync(sourceIcnsPath, join(appBundlePath, "Contents", "Resources", "icon.icns"));
  setPlistString(join(appBundlePath, "Contents", "Info.plist"), "CFBundleIconFile", "icon.icns");
}

/**
 * Read the requirement an existing signature carries, e.g. `identifier "com.peakcode.cua-helper"`.
 *
 * `codesign -d -r-` prints it as `designated => …`. A `cdhash`-anchored requirement is useless to
 * re-apply — it names the hash of code that has just been re-signed — which is why the caller
 * checks what came back before using it.
 */
function readDesignatedRequirement(appPath) {
  const match = /^designated\s*=>\s*(.+)$/m.exec(runCodesign(["-d", "-r-", appPath]).details);
  return match?.[1]?.trim() ?? null;
}

/**
 * Ad-hoc sign the bundle, which is the state macOS needs to see.
 *
 * The problem this solves: electron-builder modifies Electron's own signed code — the framework,
 * the four helper apps — and then, with no Developer ID to sign with, leaves it modified. A
 * bundle whose nested code no longer matches its signature is what macOS reports to the user as
 * a *damaged* download, and clearing the quarantine flag does not change that verdict.
 *
 * The order matters:
 *
 * 1. `--deep` signs nested code inside-out, which is how the framework and the helper apps come
 *    back to a valid state.
 * 2. `--deep` also re-signs the computer-use helper, whose Accessibility grant is filed against
 *    a *requirement* rather than a cdhash; a plain ad-hoc signature would quietly drop it. The
 *    requirement the helper was built with is put back, and
 * 3. the outer bundle is sealed again over the result, because step 2 changed the helper's bytes
 *    and the outer seal covers them.
 *
 * A failure here fails the build: the alternative is publishing the artifact users report as
 * damaged, and a release that stops is the better outcome.
 */
function adHocSign(appBundlePath) {
  const helperPath = join(
    appBundlePath,
    "Contents",
    "Resources",
    COMPUTER_USE_HELPER_DIR,
    COMPUTER_USE_HELPER_APP,
  );
  const helperRequirement = existsSync(helperPath) ? readDesignatedRequirement(helperPath) : null;
  const helperKeepsRequirement =
    helperRequirement !== null && helperRequirement.includes("identifier ");

  requireCodesign(["--force", "--deep", "--sign", "-", appBundlePath], "ad-hoc signing failed");

  if (helperKeepsRequirement) {
    requireCodesign(
      ["--force", "--sign", "-", `-r=designated => ${helperRequirement}`, helperPath],
      "re-signing the computer-use helper failed",
    );
    requireCodesign(["--force", "--sign", "-", appBundlePath], "re-sealing the bundle failed");
  }

  requireCodesign(
    ["--verify", "--deep", "--strict", appBundlePath],
    "the ad-hoc signature does not verify",
  );

  console.info(
    `[desktop-artifact] ad-hoc signed ${appBundlePath}${
      helperKeepsRequirement ? " (computer-use helper keeps its identifier requirement)" : ""
    }`,
  );
}

exports.default = async function afterPack(context) {
  const appBundlePath = findAppBundle(context);
  if (!appBundlePath) {
    throw new Error("Could not find packaged macOS app bundle to patch");
  }

  restoreLegacyIcon(context, appBundlePath);

  if (process.env[AD_HOC_SIGN_ENV] === "1") {
    adHocSign(appBundlePath);
  }
};
