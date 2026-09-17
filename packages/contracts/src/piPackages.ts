// FILE: piPackages.ts
// Purpose: Contracts for the "Pi Packages" settings surface. A pi package bundles
// extensions, skills, prompt templates, and themes behind one `npm:`/`git:`/path source
// (the `packages` array in `<agentDir>/settings.json`). Session discovery already picks
// those up; these schemas describe what the settings GUI lists and edits.
// Layer: Shared contracts
// Exports: package summary/snapshot schemas plus inferred types.

import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";

/** How pi resolves a package source. Mirrors pi's own source parsing. */
export const PiPackageSourceKind = Schema.Literals(["npm", "git", "local"]);
export type PiPackageSourceKind = typeof PiPackageSourceKind.Type;

/**
 * Where the source is recorded. `user` is `<agentDir>/settings.json` (what
 * `pi install` writes by default); `project` is `<cwd>/.pi/settings.json`.
 */
export const PiPackageScope = Schema.Literals(["user", "project"]);
export type PiPackageScope = typeof PiPackageScope.Type;

/** What a package actually contributed to the last resource scan. */
export const PiPackageResourceCounts = Schema.Struct({
  extensions: Schema.Number,
  skills: Schema.Number,
  prompts: Schema.Number,
  themes: Schema.Number,
});
export type PiPackageResourceCounts = typeof PiPackageResourceCounts.Type;

export const PiPackageSummary = Schema.Struct({
  source: TrimmedNonEmptyString,
  kind: PiPackageSourceKind,
  scope: PiPackageScope,
  /**
   * True when the package is configured but its resources are switched off by a
   * `packages` filter entry, i.e. everything ships disabled until the filter changes.
   */
  filtered: Schema.Boolean,
  /**
   * Absolute install path. Absent when the package is configured but not on disk yet —
   * pi installs missing packages on the next session start, so this is a normal state
   * for a source added on another machine.
   */
  installedPath: Schema.optional(TrimmedNonEmptyString),
  resources: PiPackageResourceCounts,
});
export type PiPackageSummary = typeof PiPackageSummary.Type;

export const PiPackagesSnapshot = Schema.Struct({
  /** Directory the listing was read from, after defaulting. */
  agentDir: TrimmedNonEmptyString,
  /** File `pi install` persists sources to. */
  settingsPath: TrimmedNonEmptyString,
  packages: Schema.Array(PiPackageSummary),
});
export type PiPackagesSnapshot = typeof PiPackagesSnapshot.Type;
