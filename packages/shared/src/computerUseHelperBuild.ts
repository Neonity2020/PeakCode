/**
 * Building the computer-use helper bundle.
 *
 * The bundle is built in two places — the desktop app builds it from source in a checkout, and
 * the release script builds the copy that ships inside the artifact — and those two builds have
 * to produce the *same kind of app*: one bundle identifier, one Info.plist, one designated
 * requirement. If they drifted, the grant the user gave would stop matching the helper it was
 * given to, which is the failure this whole design exists to avoid. So the recipe lives here
 * once rather than being mirrored by both callers.
 *
 * The identifier is the load-bearing part. It is what macOS lists in System Settings and what
 * the Accessibility grant is filed against, so it must never change: renaming it silently
 * orphans a grant the user already gave.
 *
 * Nothing here is run at import time — `resolveSigningPlan` shells out to `security`, and the
 * compile step shells out to `clang`, so a non-macOS caller simply never calls them.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  COMPUTER_USE_HELPER_APP_NAME,
  COMPUTER_USE_HELPER_BUNDLE_ID,
  COMPUTER_USE_HELPER_DISPLAY_NAME,
  COMPUTER_USE_PROTOCOL_VERSION,
} from "./computerUse.ts";

/**
 * Bumped when the way the helper is built changes.
 *
 * Part of the build fingerprint so that a change to the bundle layout, the signing identity or
 * the Info.plist re-installs a helper that would otherwise look up to date.
 */
export const HELPER_BUILD_REVISION = 1;

/** The signing identifier, which is also the bundle identifier.
 *
 *  It is what the user sees in System Settings and what the grant is filed against, so it
 *  must never change: renaming it silently orphans the grant the user already gave. */
export const HELPER_SIGNING_IDENTIFIER = COMPUTER_USE_HELPER_BUNDLE_ID;

/**
 * The designated requirement used when the helper is ad-hoc signed.
 *
 * An ad-hoc signature with no explicit requirement gets a requirement of `cdhash H"..."` — a
 * hash of the exact binary, which every rebuild changes and which would therefore drop the
 * user's grant on the floor. Naming the identifier instead makes the requirement stable across
 * rebuilds, so the grant survives them.
 *
 * It is deliberately the weakest useful requirement, and it is only ever used for ad-hoc
 * signing. See `resolveSigningPlan` for why attaching it to a certificate-signed helper would
 * be a downgrade rather than a belt-and-braces measure.
 */
export const HELPER_ADHOC_REQUIREMENT = `=designated => identifier "${HELPER_SIGNING_IDENTIFIER}"`;

/** Environment override naming a signing identity to use, for example
 *  `Developer ID Application: Acme (ABCDE12345)` or an Apple Development certificate. */
export const SIGNING_IDENTITY_ENV = "PEAKCODE_CUA_SIGN_IDENTITY";

/** The frameworks the helper links, in the order clang is given them. */
const HELPER_FRAMEWORKS = [
  "Foundation",
  "AppKit",
  "ApplicationServices",
  "CoreGraphics",
  "ImageIO",
] as const;

export interface SigningPlan {
  /** The identity to sign with, or null for an ad-hoc signature. */
  readonly identity: string | null;
  /**
   * Whether to attach `--requirements`.
   *
   * Only for ad-hoc. A certificate already produces an anchored designated requirement, and
   * passing an explicit `identifier "..."` requirement replaces it with an identifier-only one
   * — throwing away the certificate anchor and making the helper spoofable by anything that
   * picks the same bundle id. Measured, not assumed: signing with a certificate plus
   * `--requirements` yields `identifier "com.peakcode.cua-helper"` and nothing else.
   */
  readonly attachRequirement: boolean;
  /** Human-readable, recorded in the install metadata. */
  readonly label: string;
}

/** Every code-signing identity in the keychain, by `common name`. */
export function listSigningIdentities(): string[] {
  const result = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return [];
  }
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.match(/"(.+)"\s*$/)?.[1])
    .filter((name): name is string => Boolean(name));
}

/**
 * Decide how to sign, preferring durability over cryptographic strength.
 *
 * The order is deliberate and it is not "most secure first":
 *
 * - **Developer ID Application** anchors the requirement to the team, so it survives
 *   everything, including renewing the certificate. It is the only identity that is both
 *   anchored and durable, so it wins outright.
 * - **Ad-hoc with an identifier requirement** is durable too — it survives rebuilds and it
 *   has no certificate to expire. It is not anchored, so anyone who signs a binary with this
 *   bundle id would satisfy it; the token and the owner-only socket are what actually gate
 *   access.
 * - **Apple Development** is deliberately *not* auto-selected. Its requirement pins the
 *   individual certificate (`… certificate leaf[subject.CN] = "Apple Development: name (CERTID)"`),
 *   which changes when the certificate is renewed — so it would work today and break in a
 *   year, costing the user their grant for no benefit they can see. It is available on
 *   request through `PEAKCODE_CUA_SIGN_IDENTITY` for anyone who wants an anchored local build
 *   and accepts that trade.
 */
export function resolveSigningPlan(env: NodeJS.ProcessEnv = process.env): SigningPlan {
  const override = env[SIGNING_IDENTITY_ENV]?.trim();
  if (override) {
    return { identity: override, attachRequirement: false, label: override };
  }

  const developerId = listSigningIdentities().find((name) =>
    name.startsWith("Developer ID Application:"),
  );
  if (developerId) {
    return { identity: developerId, attachRequirement: false, label: developerId };
  }

  return { identity: null, attachRequirement: true, label: "ad-hoc" };
}

/** The executable inside a helper bundle. */
export function helperExecutablePath(bundlePath: string): string {
  const name = COMPUTER_USE_HELPER_APP_NAME.replace(/\.app$/, "");
  return join(bundlePath, "Contents", "MacOS", name);
}

/** Write the Info.plist that makes the bundle an app macOS will launch and list. */
export function writeHelperInfoPlist(bundlePath: string): void {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>${COMPUTER_USE_HELPER_APP_NAME.replace(/\.app$/, "")}</string>
  <key>CFBundleIdentifier</key>
  <string>${COMPUTER_USE_HELPER_BUNDLE_ID}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${COMPUTER_USE_HELPER_DISPLAY_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${COMPUTER_USE_HELPER_DISPLAY_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <!-- No dock icon, no menu bar: this app exists to hold a grant and serve a socket. -->
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppleEventsUsageDescription</key>
  <string>Peak Code Computer Use does not send Apple Events; this key is present only to document that.</string>
  <key>PeakCodeComputerUseProtocol</key>
  <integer>${COMPUTER_USE_PROTOCOL_VERSION}</integer>
</dict>
</plist>
`;
  writeFileSync(join(bundlePath, "Contents", "Info.plist"), plist);
}

export type HelperBuildResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly detail: string };

function failure(...parts: (string | undefined)[]): { ok: false; detail: string } {
  return { ok: false, detail: parts.filter(Boolean).join("\n").trim() || "no output" };
}

/**
 * Sign a helper bundle, or report why it could not be signed.
 *
 * The plan decides both the identity and the requirement — see `resolveSigningPlan`. The
 * requirement flag is attached for ad-hoc signing only, because with a certificate it would
 * replace the anchored requirement rather than add to it.
 */
export function signHelperBundle(bundlePath: string, plan: SigningPlan): HelperBuildResult {
  const arguments_ = [
    "--force",
    "--sign",
    plan.identity ?? "-",
    "--identifier",
    HELPER_SIGNING_IDENTIFIER,
  ];
  if (plan.attachRequirement) {
    // Ad-hoc only: `codesign` would otherwise write a `cdhash` requirement, which changes on
    // every rebuild. With a certificate we pass nothing and keep the anchored requirement the
    // certificate produced.
    arguments_.push("--requirements", HELPER_ADHOC_REQUIREMENT);
  }
  arguments_.push(bundlePath);

  const sign = spawnSync("codesign", arguments_, { encoding: "utf8" });
  if (sign.status !== 0) {
    return failure(sign.stderr, sign.error?.message);
  }
  return { ok: true };
}

/** Compile the helper's source into a fresh bundle at `bundlePath`. */
export function compileHelperBundle(options: {
  readonly sourcePath: string;
  readonly bundlePath: string;
  readonly plan: SigningPlan;
}): HelperBuildResult {
  mkdirSync(join(options.bundlePath, "Contents", "MacOS"), { recursive: true });
  writeHelperInfoPlist(options.bundlePath);

  const compile = spawnSync(
    "clang",
    [
      "-fobjc-arc",
      "-O2",
      "-fvisibility=default",
      ...HELPER_FRAMEWORKS.flatMap((framework) => ["-framework", framework]),
      "-o",
      helperExecutablePath(options.bundlePath),
      options.sourcePath,
    ],
    { encoding: "utf8" },
  );

  if (compile.status !== 0) {
    return failure(compile.stderr, compile.error?.message);
  }

  return signHelperBundle(options.bundlePath, options.plan);
}

/**
 * Pull the designated requirement out of a `codesign --display --requirements -` report.
 *
 * Two shapes have to be read, and missing the second one would downgrade a good signature:
 *
 * - an **explicit** requirement (`codesign --requirements …`, which is what this app's ad-hoc
 *   signing passes) prints as `designated => …`;
 * - an **implicit** one — what a certificate produces, and what an ad-hoc signature with no
 *   requirement produces — prints commented out, as `# designated => …`.
 *
 * Both are the requirement the system checks; the `#` only means "you did not have to write
 * this down".
 */
export function parseDesignatedRequirement(report: string): string | null {
  const line = report
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.replace(/^#\s*/, "").startsWith("designated =>"));
  if (!line) {
    return null;
  }
  return line.replace(/^#\s*/, "").slice("designated =>".length).trim() || null;
}

/**
 * The designated requirement of an already-signed bundle, or null when it has none.
 *
 * `codesign` writes the requirement to stdout and the rest of the report to stderr, and exits
 * non-zero for a bundle that is unsigned or whose signature no longer validates — both of which
 * are "no requirement", not an error worth propagating.
 */
export function helperDesignatedRequirement(bundlePath: string): string | null {
  const result = spawnSync("codesign", ["--display", "--requirements", "-", bundlePath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }
  return parseDesignatedRequirement(result.stdout ?? "");
}

/**
 * Whether a requirement is anchored to Apple's certificate chain.
 *
 * This is the test for "can this signature be kept as it is?". An anchored requirement names a
 * team, so it is durable and cannot be reproduced on a machine that does not hold that team's
 * certificate — a re-sign there would replace it with something weaker. An unanchored one is a
 * `cdhash` (changes on every rebuild) or an identifier, and the install path replaces both with
 * the requirement this machine can actually keep.
 */
export function isAnchoredRequirement(requirement: string | null): boolean {
  return requirement !== null && requirement.includes("anchor apple");
}

/**
 * The fingerprint that decides whether an install is already current.
 *
 * Every input that would change the installed bundle is folded in: the artifact's own bytes,
 * the build revision, the identifier, and the signing plan (which decides the designated
 * requirement, and therefore whether the user's grant still matches). Two runs that would
 * produce the same bundle produce the same fingerprint — which is what lets the caller leave a
 * good install untouched, and that is what keeps the grant alive.
 */
function helperBuildFingerprint(artifact: Buffer, plan: SigningPlan): string {
  const hash = createHash("sha256");
  hash.update(artifact);
  hash.update(
    `\n${HELPER_BUILD_REVISION}\n${HELPER_SIGNING_IDENTIFIER}\n${plan.label}\n${HELPER_ADHOC_REQUIREMENT}\n`,
  );
  return hash.digest("hex");
}

/** The fingerprint of a helper built from `main.m` on this machine. */
export function helperSourceFingerprint(sourcePath: string, plan: SigningPlan): string {
  return helperBuildFingerprint(readFileSync(sourcePath), plan);
}

/**
 * The fingerprint of a helper that shipped inside a packaged app.
 *
 * Hashed over the shipped executable rather than over a manifest, because the executable is
 * the thing that will be installed: if it differs, the install has to run, and if it does not,
 * nothing should be touched.
 */
export function helperBundleFingerprint(bundlePath: string, plan: SigningPlan): string {
  return helperBuildFingerprint(readFileSync(helperExecutablePath(bundlePath)), plan);
}
