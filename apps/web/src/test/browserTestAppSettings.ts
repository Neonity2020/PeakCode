// FILE: browserTestAppSettings.ts
// Purpose: Helpers that pin persisted app settings before an app-level browser test
//          mounts, so assertions run against stable copy instead of the locale default.
// Layer: Browser test helper (not collected as a test file)

import { APP_SETTINGS_STORAGE_KEY } from "../appSettings";

/** Persists the UI language for the next app mount (tests call this after localStorage.clear()). */
export function seedBrowserTestLanguage(language: "en" | "zh" = "en"): void {
  globalThis.localStorage?.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ language }));
}
