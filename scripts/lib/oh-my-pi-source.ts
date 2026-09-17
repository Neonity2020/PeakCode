/**
 * Shared plumbing for the oh-my-pi generators (`generate-oh-my-pi-theme-seeds.ts` and
 * `generate-oh-my-pi-bundled-skills.ts`).
 *
 * Both read from an oh-my-pi checkout, both stamp the upstream commit into the generated
 * header, and both are re-run by hand when the vendored content is refreshed — so the
 * attribution and the `--source` contract live here rather than in each script.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/** Upstream repository the vendored content comes from. */
export const UPSTREAM_SOURCE = "can1357/oh-my-pi";

/**
 * Read `--source <path>` from a script's argv.
 *
 * Last occurrence wins, so a wrapper script can override a defaulted value. Fails loudly
 * instead of defaulting: generating from the wrong checkout would silently rewrite committed
 * content, and there is no checkout path that is correct on every machine.
 */
export function resolveOhMyPiSource(argv: readonly string[]): string {
  let source = "";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--source") source = argv[index + 1] ?? "";
  }
  if (!source) throw new Error("missing --source <path to an oh-my-pi checkout>");
  return resolve(source);
}

/** Commit the generated content was derived from, for the header. */
export function gitHead(source: string): string {
  try {
    return execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * The MIT attribution line every generated file carries. Kept in one place because the
 * notice is a license requirement, not decoration.
 */
export function upstreamAttribution(commit: string): string {
  return `${UPSTREAM_SOURCE}@${commit} (MIT). Do not edit by hand.`;
}
