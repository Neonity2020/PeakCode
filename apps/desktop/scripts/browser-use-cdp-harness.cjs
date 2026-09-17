// FILE: browser-use-cdp-harness.cjs
// Purpose: Runs a real Electron browser and exposes its CDP to the browser-use E2E driver.
// Layer: Desktop test harness
// Depends on: Electron, Node net/http primitives
//
// Plain CommonJS on purpose: Electron runs this file directly, with no build step, so the
// E2E can exercise real CDP without depending on the app bundle.
//
// Each tab is a real WebContentsView with its own attached debugger, so "tabs" behave the
// way the product's do: independent documents with independent CDP sessions. The driver
// talks to us over a unix socket (path in PEAKCODE_E2E_BRIDGE_SOCKET) with newline-delimited
// JSON, which keeps stdout free for Electron's own logging.

const { app, BrowserWindow, WebContentsView } = require("electron");
const FS = require("node:fs");
const HTTP = require("node:http");
const Net = require("node:net");

const BRIDGE_SOCKET = process.env.PEAKCODE_E2E_BRIDGE_SOCKET;

const PAGE_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Peak Code Browser E2E</title>
  </head>
  <body>
    <h1>Browser E2E</h1>
    <input id="name" aria-label="Name" />
    <button id="submit" type="button" aria-label="Submit">Submit</button>
    <select id="pick" aria-label="Pick">
      <option value="alpha">Alpha</option>
      <option value="beta">Beta</option>
    </select>
    <input id="remember" type="checkbox" aria-label="Remember me" />
    <div id="result">idle</div>
    <div id="keyboard">no-key</div>
    <div style="height: 2500px">tall spacer</div>
    <button id="bottom" type="button" aria-label="Bottom marker">Bottom marker</button>
    <script>
      const result = document.getElementById("result");
      document.getElementById("submit").addEventListener("click", () => {
        result.textContent = "clicked:" + document.getElementById("name").value;
      });
      document.getElementById("name").addEventListener("keydown", (event) => {
        document.getElementById("keyboard").textContent = "key:" + event.key;
      });
    </script>
  </body>
</html>`;

const SECOND_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Second page</title></head>
  <body><h1>Second page</h1><a id="back" href="/">Home</a></body>
</html>`;

/** Tabs the driver asked for, in creation order. */
const tabs = [];
let activeTabId = null;
let nextTabId = 1;

const send = (socket, message) => {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
};

function startPageServer() {
  const server = HTTP.createServer((request, response) => {
    const second = request.url.startsWith("/second");
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      // A stable title/URL pair per route makes navigation assertions meaningful.
      "cache-control": "no-store",
    });
    response.end(second ? SECOND_HTML : PAGE_HTML);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function createTab(url) {
  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const tab = { id: nextTabId++, view, url: url ?? "about:blank" };
  tabs.push(tab);
  activeTabId = tab.id;

  // Real CDP, attached exactly the way the product attaches it.
  view.webContents.debugger.attach("1.3");
  if (tab.url && tab.url !== "about:blank") {
    void view.webContents.loadURL(tab.url);
  }
  return tab;
}

const findTab = (tabId) => tabs.find((tab) => tab.id === tabId);

function describeTab(tab) {
  const contents = tab.view.webContents;
  return {
    id: tab.id,
    title: contents.getTitle(),
    url: contents.getURL(),
    active: tab.id === activeTabId,
  };
}

async function handle(request) {
  switch (request.op) {
    case "createTab": {
      const tab = createTab(request.url);
      await new Promise((resolve) => {
        if (tab.view.webContents.isLoading()) {
          tab.view.webContents.once("did-finish-load", resolve);
          tab.view.webContents.once("did-fail-load", resolve);
        } else {
          resolve();
        }
      });
      return describeTab(tab);
    }
    case "closeTab": {
      const tab = findTab(request.tabId);
      if (!tab) throw new Error(`no such tab: ${request.tabId}`);
      tab.view.webContents.debugger.detach();
      tab.view.webContents.close();
      tabs.splice(tabs.indexOf(tab), 1);
      if (activeTabId === tab.id) activeTabId = tabs[0]?.id ?? null;
      return {};
    }
    case "activateTab": {
      const tab = findTab(request.tabId);
      if (!tab) throw new Error(`no such tab: ${request.tabId}`);
      activeTabId = tab.id;
      return describeTab(tab);
    }
    case "listTabs":
      return tabs.map(describeTab);
    case "cdp": {
      const tab = findTab(request.tabId);
      if (!tab) throw new Error(`no such tab: ${request.tabId}`);
      const debugger_ = tab.view.webContents.debugger;
      if (!debugger_.isAttached()) debugger_.attach("1.3");
      return await debugger_.sendCommand(request.method, request.params ?? {});
    }
    case "shutdown":
      return { stopping: true };
    default:
      throw new Error(`unknown harness op: ${request.op}`);
  }
}

async function main() {
  if (!BRIDGE_SOCKET) {
    throw new Error("PEAKCODE_E2E_BRIDGE_SOCKET is required");
  }

  const pageServer = await startPageServer();
  const pagePort = pageServer.address().port;

  // A hidden window still lays out and paints, which is what screenshots need. It is never
  // shown, so the E2E cannot steal the user's focus.
  const window = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    webPreferences: { backgroundThrottling: false },
  });
  const rootTab = createTab(`http://127.0.0.1:${pagePort}/`);
  window.contentView.addChildView(rootTab.view);
  rootTab.view.setBounds({ x: 0, y: 0, width: 1024, height: 768 });

  await new Promise((resolve) => {
    if (rootTab.view.webContents.isLoading()) {
      rootTab.view.webContents.once("did-finish-load", resolve);
      rootTab.view.webContents.once("did-fail-load", resolve);
    } else {
      resolve();
    }
  });

  const socket = Net.createConnection(BRIDGE_SOCKET);
  let buffered = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffered += chunk;
    for (;;) {
      const newline = buffered.indexOf("\n");
      if (newline < 0) break;
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line.trim().length === 0) continue;

      const request = JSON.parse(line);
      void handle(request).then(
        (result) => send(socket, { id: request.id, result }),
        (error) =>
          send(socket, {
            id: request.id,
            error: error instanceof Error ? error.message : String(error),
          }),
      );
    }
  });

  socket.once("connect", () => {
    send(socket, { event: "ready", pagePort, tabs: tabs.map(describeTab) });
  });
  socket.once("error", (error) => {
    console.error("[harness] bridge socket failed:", error.message);
    app.exit(1);
  });
  socket.once("close", () => {
    pageServer.close();
    app.quit();
  });
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error("[harness] fatal:", error);
    app.exit(1);
  });

// The harness owns its own lifetime: the driver closing the bridge socket is the stop signal.
app.on("window-all-closed", () => {});
