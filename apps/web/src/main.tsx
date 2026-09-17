import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource-variable/jetbrains-mono";
import "katex/dist/katex.min.css";
import "@xterm/xterm/css/xterm.css";
import "./index.css";
import "./storageKeyMigration";

import {
  PairingFailedScreen,
  clearPairingLocation,
  consumeMobilePairing,
  pairingTargetFrom,
  setHandedOffProjectId,
} from "./mobilePairing";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

/**
 * Boot order matters here: the phone hand-off link has to become a session cookie before
 * the router — and with it the first WebSocket — exists, and the history instance must
 * never be created from a /pair URL. That is why the app modules are imported after the
 * exchange instead of at the top of this file.
 */
void (async () => {
  const target = pairingTargetFrom(window.location.href);
  const pairing = await consumeMobilePairing(window.location.href);

  if (pairing.status === "failed") {
    root.render(
      <React.StrictMode>
        <PairingFailedScreen message={pairing.message} />
      </React.StrictMode>,
    );
    return;
  }

  if (pairing.status === "paired") {
    // A thread lands the phone straight in the conversation the desktop showed; a bare
    // project is only a hint for the next chat, so it waits in the route that starts one.
    setHandedOffProjectId(target.projectId);
    clearPairingLocation(target);
  }

  const [{ RouterProvider }, { appHistory }, { getRouter }, { APP_DISPLAY_NAME }] =
    await Promise.all([
      import("@tanstack/react-router"),
      import("./appNavigation"),
      import("./router"),
      import("./branding"),
    ]);

  document.title = APP_DISPLAY_NAME;
  const router = getRouter(appHistory);

  root.render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  );
})().catch((error: unknown) => {
  root.render(
    <React.StrictMode>
      <PairingFailedScreen message={error instanceof Error ? error.message : String(error)} />
    </React.StrictMode>,
  );
});
