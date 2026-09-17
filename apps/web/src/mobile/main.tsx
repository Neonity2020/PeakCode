// FILE: mobile/main.tsx
// Purpose: Boot for the phone page. It is a separate entry from the desktop app on
//          purpose: the phone gets a remote control for this computer, not the desktop
//          shell squeezed onto a small screen.
// Layer: Mobile entry
// Depends on: the shared pairing hand-off, i18n, and RemoteControlApp.

import React from "react";
import ReactDOM from "react-dom/client";

// The design tokens and utility classes are shared with the desktop app; none of its
// components are.
import "../index.css";

import { detectBrowserLanguage, I18nProvider } from "../i18n";
import {
  PairingFailedScreen,
  clearMobilePairingLocation,
  consumeMobilePairing,
  pairingTargetFrom,
} from "../mobilePairing";
import { RemoteControlApp } from "./RemoteControlApp";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

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
    // Stay on this page — the credential is spent, the phone does not need it in the URL.
    clearMobilePairingLocation();
  }

  root.render(
    <React.StrictMode>
      <I18nProvider language={detectBrowserLanguage()}>
        <RemoteControlApp
          initialThreadId={target.threadId}
          highlightedProjectId={target.projectId}
        />
      </I18nProvider>
    </React.StrictMode>,
  );
})().catch((error: unknown) => {
  root.render(
    <React.StrictMode>
      <PairingFailedScreen message={error instanceof Error ? error.message : String(error)} />
    </React.StrictMode>,
  );
});
