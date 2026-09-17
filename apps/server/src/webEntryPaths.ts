// FILE: webEntryPaths.ts
// Purpose: The web build has two HTML entries — the desktop app and the phone's remote
//          control — and this is the one place that says which request belongs to which.
//          The phone page answers on a short path so a QR code stays small and a person can
//          read it out loud.
// Layer: Server HTTP support
// Exports: PHONE_ENTRY_PATH, PHONE_PAGE_ROUTE, resolveWebEntryFilePath

/** Where the phone page lives inside the built web bundle. */
export const PHONE_ENTRY_PATH = "/mobile.html";
/** The address the QR code points at, in dev and in a packaged build alike. */
export const PHONE_PAGE_ROUTE = "/h5";

/**
 * The HTML file a request should be served from, or null when the path is a plain asset
 * that the ordinary static resolution already handles.
 */
export function resolveWebEntryFilePath(pathname: string): string | null {
  const normalized =
    pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  return normalized === PHONE_PAGE_ROUTE || normalized === PHONE_ENTRY_PATH
    ? PHONE_ENTRY_PATH
    : null;
}
