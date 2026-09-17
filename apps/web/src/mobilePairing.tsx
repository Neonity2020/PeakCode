// FILE: mobilePairing.tsx
// Purpose: Consume the phone hand-off link (`/pair#token=…`). The credential becomes an
//          HttpOnly session cookie before the first WebSocket connects, which is what
//          lets a phone that only ever scanned a QR code act as a signed-in client.
// Layer: Web entry support
// Exports: PAIRING_PATHS, pairingCredentialFrom, pairingTargetFrom, consumeMobilePairing,
//          clearPairingLocation, clearMobilePairingLocation, setHandedOffProjectId,
//          readHandedOffProjectId, PairingFailedScreen

import { APP_BASE_NAME } from "./branding";

export type PairingOutcome =
  | { readonly status: "none" }
  | { readonly status: "paired" }
  | { readonly status: "failed"; readonly message: string };

/** The conversation the desktop was showing when it minted the link. */
export interface PairingTarget {
  readonly threadId: string | null;
  readonly projectId: string | null;
}

/**
 * The credential inside a pairing URL, or null when this is not one.
 *
 * The token travels in the hash (not the query) so it never reaches a server log; the
 * server issues the same shape for desktop bootstrap.
 */
export function pairingCredentialFrom(href: string): string | null {
  const token = pairingHashParameters(href)?.get("token");
  return token !== null && token !== undefined && token.trim().length > 0 ? token : null;
}

/**
 * The pages a hand-off link may land on.
 *
 * `/h5` is the phone page the QR code points at; `/pair` is the desktop shell's own
 * bootstrap, and `/mobile.html` is the same phone page as it exists in a dev server.
 */
export const PAIRING_PATHS = ["/pair", "/h5", "/mobile.html"] as const;

/**
 * Everything the hand-off link carries after the `#`, or null when this is not one.
 *
 * A base is supplied so the path check also works for a relative href; the caller passes
 * the live location, which is absolute anyway.
 */
function pairingHashParameters(href: string): URLSearchParams | null {
  let url: URL;
  try {
    url = new URL(href, "http://pairing.invalid");
  } catch {
    return null;
  }
  const pathname = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  if (!PAIRING_PATHS.some((path) => path === pathname)) return null;
  return new URLSearchParams(url.hash.replace(/^#/, ""));
}

/**
 * The conversation the link carries, so the phone opens what the desktop was looking at.
 *
 * Both fields are optional: the desktop sends a thread when one is open, a project when
 * only a project is, and neither from the settings screens.
 */
export function pairingTargetFrom(href: string): PairingTarget {
  const parameters = pairingHashParameters(href);
  const threadId = parameters?.get("thread") ?? null;
  const projectId = parameters?.get("project") ?? null;
  return {
    threadId: threadId !== null && threadId.length > 0 ? threadId : null,
    projectId: projectId !== null && projectId.length > 0 ? projectId : null,
  };
}

/** Exchange the credential for a session. Never throws — the caller renders the failure. */
export async function consumeMobilePairing(href: string): Promise<PairingOutcome> {
  const credential = pairingCredentialFrom(href);
  if (credential === null) return { status: "none" };
  try {
    const response = await fetch("/api/auth/bootstrap", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    if (response.ok) return { status: "paired" };
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const message =
      payload && typeof payload.error === "string"
        ? payload.error
        : `The link could not be used (status ${response.status}).`;
    return { status: "failed", message };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Drop the pairing URL from history so a reload does not retry a spent credential, and
 * leave the desktop app on the conversation the link carried.
 */
export function clearPairingLocation(target: PairingTarget): void {
  window.history.replaceState(null, "", target.threadId === null ? "/" : `/${target.threadId}`);
}

/**
 * The same cleanup for the phone page: the credential goes, the page stays.
 *
 * The phone page is one surface with its own state, so there is no route to navigate to —
 * it only has to stop carrying a one-time token in a URL that is now visible in history.
 */
export function clearMobilePairingLocation(): void {
  window.history.replaceState(null, "", window.location.pathname);
}

/**
 * The project a paired phone should start its next chat in.
 *
 * A link minted from a chat that had not sent anything yet carries the project instead of
 * a thread. The value is read rather than consumed: the index route may run its effect
 * more than once for a single visit, and every run should reach the same answer. It lives
 * for the page session, so a reload — which is not a pairing — starts from nothing again.
 */
let handedOffProjectId: string | null = null;

export function setHandedOffProjectId(projectId: string | null): void {
  handedOffProjectId = projectId;
}

export function readHandedOffProjectId(): string | null {
  return handedOffProjectId;
}

export function PairingFailedScreen({ message }: { readonly message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-background-elevated-secondary,#111)] p-6 text-foreground">
      <div className="flex max-w-sm flex-col gap-2 rounded-xl border border-border/70 bg-background p-5 text-center">
        <h1 className="text-sm font-semibold">Pairing link expired</h1>
        <p className="text-xs text-muted-foreground">
          This phone link can only be used once and stays valid for a few minutes. Open{" "}
          {APP_BASE_NAME} on the machine, click the phone icon next to Settings, and scan the fresh
          code.
        </p>
        <p className="text-[11px] text-muted-foreground/78">{message}</p>
      </div>
    </div>
  );
}
