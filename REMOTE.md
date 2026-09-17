# Remote Access Setup

Use this when you want to open Peak Code from another device (phone, tablet, another laptop).

## CLI ↔ Env option map

The Peak Code CLI accepts the following configuration options, available either as CLI flags or environment variables:

| CLI flag                | Env var               | Notes                              |
| ----------------------- | --------------------- | ---------------------------------- |
| `--mode <web\|desktop>` | `PEAKCODE_MODE`       | Runtime mode.                      |
| `--port <number>`       | `PEAKCODE_PORT`       | HTTP/WebSocket port.               |
| `--host <address>`      | `PEAKCODE_HOST`       | Bind interface/address.            |
| `--home-dir <path>`     | `PEAKCODE_HOME`       | Base directory.                    |
| `--dev-url <url>`       | `VITE_DEV_SERVER_URL` | Dev web URL redirect/proxy target. |
| `--no-browser`          | `PEAKCODE_NO_BROWSER` | Disable auto-open browser.         |
| `--auth-token <token>`  | `PEAKCODE_AUTH_TOKEN` | WebSocket auth token.              |

> TIP: Use the `--help` flag to see all available options and their descriptions.

## Security First

- Always set `--auth-token` before exposing the server outside localhost.
- Treat the token like a password.
- Prefer binding to trusted interfaces (LAN IP or Tailnet IP) instead of opening all interfaces unless needed.

## 1) Build + run server for remote access

Remote access should use the built web app (not local Vite redirect mode).

```bash
bun run build
TOKEN="$(openssl rand -hex 24)"
bun run --cwd apps/server start -- --host 0.0.0.0 --port 3773 --auth-token "$TOKEN" --no-browser
```

Then open on your phone:

`http://<your-machine-ip>:3773`

Example:

`http://192.168.1.42:3773`

Notes:

- `--host 0.0.0.0` listens on all IPv4 interfaces.
- `--no-browser` prevents local auto-open, which is usually better for headless/remote sessions.
- Ensure your OS firewall allows inbound TCP on the selected port.

## 2) Tailnet / Tailscale access

If you use Tailscale, you can bind directly to your Tailnet address.

```bash
TAILNET_IP="$(tailscale ip -4)"
TOKEN="$(openssl rand -hex 24)"
bun run --cwd apps/server start -- --host "$(tailscale ip -4)" --port 3773 --auth-token "$TOKEN" --no-browser
```

Open from any device in your tailnet:

`http://<tailnet-ip>:3773`

You can also bind `--host 0.0.0.0` and connect through the Tailnet IP, but binding directly to the Tailnet IP limits exposure.

## 3) Code on a remote dev box (SSH tunnel)

When the code you want the agent to work on lives on a machine you reach over SSH, run Peak Code on
that machine and keep the browser on your laptop. The agent, the workspace and the git history all
stay where the code is, and nothing has to be reachable from the network: the server binds its own
loopback and the SSH tunnel is the only way in.

```bash
# On the remote host, from a checkout of this repository.
bun run build
TOKEN="$(openssl rand -hex 24)"
bun run --cwd apps/server start -- --host 127.0.0.1 --port 3773 --auth-token "$TOKEN" --no-browser

# On your laptop, in a second terminal. Keep it running while you work.
ssh -N -L 3773:127.0.0.1:3773 you@remote-host
```

Then open `http://127.0.0.1:3773` on your laptop and connect with `$TOKEN`, the same way as above.

Notes:

- `--host 127.0.0.1` keeps the server off every interface of the remote machine, so the token and the
  SSH account are what stand between the API and everyone else.
- Add the forward to `~/.ssh/config` (`LocalForward 3773 127.0.0.1:3773`) if you use this daily.
- Dropping the tunnel closes the browser connection; Peak Code reconnects by itself once the tunnel
  and the server are back.
- Everything that runs locally for the agent — file reads and writes, git, terminals — resolves
  against the remote workspace, because that is where the server runs.

## 4) Built-in Cloudflare tunnel (phone / H5)

The same thing without leaving the app: Peak Code can publish itself on a temporary
Cloudflare address and hand it to a phone as a QR code.

1. Click the phone icon next to **Settings** in the sidebar (or **Settings → Channels**).
2. Press **Start Cloudflare tunnel**. The server runs
   `cloudflared tunnel --url http://127.0.0.1:<port>` and shows the assigned
   `https://<random-words>.trycloudflare.com` address.
3. Scan the QR code with the phone. The code carries a one-time pairing credential, and the
   phone opens **`/h5`**: a page built for phones, not the desktop app on a small screen.

## What the phone page is (and is not)

It is a **remote control for the machine that is running Peak Code**, not a copy of it.

- The phone shows what this computer is working on — its workspaces and tasks, with the state
  of each one — and lets you open a task, read the conversation and reply. Approvals raised by
  a paused run can be answered from there too.
- **Everything runs on the computer.** The agent, the files, git and the terminals never leave
  it; the phone only sends commands over the connection and watches the result.
- The page is its own entry point (`apps/web/mobile.html` → `/h5`), so none of the desktop
  surface — split panes, terminal, kanban board, plugins, settings — is shipped to a phone
  that has no use for it.
- The link carries the conversation that was open on the desktop, so the phone continues that
  chat instead of starting from a list (a chat that has not sent anything yet hands over its
  project, which the list marks as the current one).

Notes:

- Running from source (`bun run dev`)? The phone still works: a browser **on this machine**
  is redirected to the Vite dev server, while the tunnel and LAN addresses are served the dev
  app through the server itself. A redirect to `localhost` would only ever reach the phone's
  own loopback.
- The phone has no composer history of its own, so its messages run on **Settings → General →
  Default model**. With nothing configured there it takes the first model the provider
  offers. The same setting is used by runs that have no composer at all (IM chats, kanban
  cards, automations).
- A model that the provider stops serving does not silence those runs: a configured default
  is only used while the provider still offers it, and anything else falls back to an
  offered model (the phone says which one above the composer). Endpoints that list models
  they no longer serve — a gateway configured with its own model list — are filtered out of
  the picker too, so a stale slug cannot be chosen again.

- Install the client once: `brew install cloudflared` (macOS) — the binary path is
  configurable in Settings → Channels.
- **The tunnel only opens on a server that requires authentication.** Restart with
  `--auth-token <token>` first (the desktop app always has one); without it Peak Code
  refuses to publish itself, because a quick-tunnel address is public.
- The address is random and short-lived: it changes every time the tunnel restarts, and
  pressing _Stop_ takes it down (the last address stays visible for reference).
- Leave **Open the tunnel on startup** checked to keep the QR code working across restarts.
- Pairing links stay one-time and expire; a leaked address alone does not grant access.
