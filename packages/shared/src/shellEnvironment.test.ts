// FILE: shellEnvironment.test.ts
// Purpose: Verifies the login-shell capture is reused only while it still describes the
//   machine's shell setup, and that hydration keeps the process's own environment.

import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureShellEnvironment,
  collectShellStartupStamps,
  createFileShellEnvironmentCache,
  defaultShellEnvironmentCachePath,
  hydrateShellEnvironment,
  SHELL_ENVIRONMENT_NAMES,
  type ShellEnvironmentCacheStore,
} from "./shellEnvironment";

const CAPTURED_NAMES = [...SHELL_ENVIRONMENT_NAMES];

function memoryCache(initial?: string): ShellEnvironmentCacheStore & {
  readonly contents: () => string | undefined;
} {
  let value = initial;
  return {
    read: () => value,
    write: (contents) => {
      value = contents;
    },
    contents: () => value,
  };
}

function fixedStamps(): Record<string, string> {
  return { "/fake/.zshrc": "1:1" };
}

const temporaryHomes: string[] = [];

function makeTemporaryHome(): string {
  const home = mkdtempSync(Path.join(OS.tmpdir(), "peakcode-shell-env-"));
  temporaryHomes.push(home);
  return home;
}

afterEach(() => {
  while (temporaryHomes.length > 0) {
    const home = temporaryHomes.pop();
    if (home) rmSync(home, { recursive: true, force: true });
  }
});

describe("captureShellEnvironment", () => {
  it("probes the login shell once and reuses the capture afterwards", () => {
    const cache = memoryCache();
    const readEnvironment = vi.fn(() => ({ PATH: "/opt/homebrew/bin:/usr/bin" }));
    const options = {
      env: { SHELL: "/bin/zsh" } as NodeJS.ProcessEnv,
      platform: "linux" as NodeJS.Platform,
      userShell: "/bin/zsh",
      readEnvironment,
      readStamps: fixedStamps,
      cache,
    };

    const first = captureShellEnvironment(options);
    expect(first.source).toBe("login-shell");
    expect(first.environment.PATH).toBe("/opt/homebrew/bin:/usr/bin");
    expect(readEnvironment).toHaveBeenCalledWith("/bin/zsh", CAPTURED_NAMES);
    expect(cache.contents()).toBeDefined();

    const second = captureShellEnvironment(options);
    expect(second.source).toBe("cache");
    expect(second.environment.PATH).toBe("/opt/homebrew/bin:/usr/bin");
    // The whole point: no second login shell.
    expect(readEnvironment).toHaveBeenCalledTimes(1);
  });

  it("re-probes when a shell startup file changes", () => {
    const home = makeTemporaryHome();
    const zshrc = Path.join(home, ".zshrc");
    writeFileSync(zshrc, "# v1\n");

    const cache = memoryCache();
    const readEnvironment = vi.fn(() => ({ PATH: "/opt/homebrew/bin:/usr/bin" }));
    const options = {
      env: { SHELL: "/bin/zsh" } as NodeJS.ProcessEnv,
      platform: "linux" as NodeJS.Platform,
      userShell: "/bin/zsh",
      homeDir: home,
      readEnvironment,
      cache,
    };

    expect(captureShellEnvironment(options).source).toBe("login-shell");

    writeFileSync(zshrc, "# v2 with a different size\n");
    utimesSync(zshrc, new Date(2_000), new Date(2_000));

    expect(captureShellEnvironment(options).source).toBe("login-shell");
    expect(readEnvironment).toHaveBeenCalledTimes(2);
  });

  it("re-probes once the capture is older than the reuse window", () => {
    const cache = memoryCache();
    const readEnvironment = vi.fn(() => ({ PATH: "/opt/homebrew/bin:/usr/bin" }));
    const base = {
      env: { SHELL: "/bin/zsh" } as NodeJS.ProcessEnv,
      platform: "linux" as NodeJS.Platform,
      userShell: "/bin/zsh",
      readEnvironment,
      readStamps: fixedStamps,
      cache,
      maxCacheAgeMs: 1_000,
    };

    expect(captureShellEnvironment({ ...base, now: () => 5_000 }).source).toBe("login-shell");
    expect(captureShellEnvironment({ ...base, now: () => 5_500 }).source).toBe("cache");
    expect(captureShellEnvironment({ ...base, now: () => 20_000 }).source).toBe("login-shell");
    expect(readEnvironment).toHaveBeenCalledTimes(2);
  });

  it("ignores unreadable and stale cache entries", () => {
    const readEnvironment = vi.fn(() => ({ PATH: "/opt/homebrew/bin:/usr/bin" }));
    const options = {
      env: { SHELL: "/bin/zsh" } as NodeJS.ProcessEnv,
      platform: "linux" as NodeJS.Platform,
      userShell: "/bin/zsh",
      readEnvironment,
      readStamps: fixedStamps,
    };

    for (const contents of ["not json", "{}", JSON.stringify({ version: 99 })]) {
      const cache = memoryCache(contents);
      expect(captureShellEnvironment({ ...options, cache }).source).toBe("login-shell");
    }
    expect(readEnvironment).toHaveBeenCalledTimes(3);
  });

  it("still captures when the cache itself is broken", () => {
    const cache: ShellEnvironmentCacheStore = {
      read: () => {
        throw new Error("EACCES");
      },
      write: () => {
        throw new Error("EROFS");
      },
    };

    const captured = captureShellEnvironment({
      env: { SHELL: "/bin/zsh" } as NodeJS.ProcessEnv,
      platform: "linux",
      userShell: "/bin/zsh",
      readEnvironment: () => ({ PATH: "/usr/local/bin:/usr/bin" }),
      readStamps: fixedStamps,
      cache,
    });

    expect(captured.source).toBe("login-shell");
    expect(captured.environment.PATH).toBe("/usr/local/bin:/usr/bin");
  });

  it("does not remember an empty capture", () => {
    const cache = memoryCache();
    const readEnvironment = vi.fn(() => ({}));
    const options = {
      env: { SHELL: "/bin/zsh" } as NodeJS.ProcessEnv,
      platform: "linux" as NodeJS.Platform,
      userShell: "/bin/zsh",
      readEnvironment,
      readStamps: fixedStamps,
      cache,
    };

    expect(captureShellEnvironment(options).source).toBe("unavailable");
    expect(cache.contents()).toBeUndefined();
  });
});

describe("hydrateShellEnvironment", () => {
  const captured = {
    PATH: "/opt/homebrew/bin:/usr/bin",
    SSH_AUTH_SOCK: "/tmp/login-shell.sock",
    HOMEBREW_PREFIX: "/opt/homebrew",
  };

  it("merges PATH and fills names the process does not have", () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/bin/zsh",
      PATH: "/Users/test/.local/bin:/usr/bin",
    };

    hydrateShellEnvironment(env, {
      platform: "darwin",
      userShell: "/bin/zsh",
      readEnvironment: () => captured,
      readStamps: fixedStamps,
    });

    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/Users/test/.local/bin");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/login-shell.sock");
    expect(env.HOMEBREW_PREFIX).toBe("/opt/homebrew");
  });

  it("preserves names the process already has", () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/bin/zsh",
      PATH: "/usr/bin",
      SSH_AUTH_SOCK: "/tmp/inherited.sock",
    };

    hydrateShellEnvironment(env, {
      platform: "darwin",
      userShell: "/bin/zsh",
      readEnvironment: () => captured,
      readStamps: fixedStamps,
    });

    expect(env.SSH_AUTH_SOCK).toBe("/tmp/inherited.sock");
  });

  it("applies only PATH when the caller asks for it", () => {
    const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };

    hydrateShellEnvironment(env, {
      platform: "linux",
      userShell: "/bin/zsh",
      names: ["PATH"],
      readEnvironment: () => captured,
      readStamps: fixedStamps,
    });

    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
    expect(env.SSH_AUTH_SOCK).toBeUndefined();
    expect(env.HOMEBREW_PREFIX).toBeUndefined();
  });

  it("leaves the environment alone on unsupported platforms", () => {
    const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "C:/Windows/System32" };
    const readEnvironment = vi.fn(() => captured);

    hydrateShellEnvironment(env, { platform: "win32", readEnvironment });

    expect(readEnvironment).not.toHaveBeenCalled();
    expect(env.PATH).toBe("C:/Windows/System32");
  });
});

describe("collectShellStartupStamps", () => {
  it("marks missing files and reports a changed file as a new stamp", () => {
    const home = makeTemporaryHome();
    const input = { platform: "linux" as NodeJS.Platform, shells: ["/bin/zsh"], homeDir: home };

    const before = collectShellStartupStamps(input);
    expect(Object.keys(before)).toContain("/etc/zshrc");
    expect(before[Path.join(home, ".zshrc")]).toBe("absent");

    writeFileSync(Path.join(home, ".zshrc"), "# configured\n");

    const after = collectShellStartupStamps(input);
    expect(after[Path.join(home, ".zshrc")]).not.toBe("absent");
    expect(after[Path.join(home, ".zshrc")]).not.toBe(before[Path.join(home, ".zshrc")]);
  });
});

describe("defaultShellEnvironmentCachePath", () => {
  it("sits under the configured home directory", () => {
    expect(
      defaultShellEnvironmentCachePath({ PEAKCODE_HOME: "/tmp/peakcode-dev" }, "/home/u"),
    ).toBe("/tmp/peakcode-dev/userdata/shell-environment.json");
  });

  it("falls back to ~/.peakcode", () => {
    expect(defaultShellEnvironmentCachePath({}, "/home/u")).toBe(
      "/home/u/.peakcode/userdata/shell-environment.json",
    );
  });
});

describe("createFileShellEnvironmentCache", () => {
  it("round-trips through the file system", () => {
    const home = makeTemporaryHome();
    const cache = createFileShellEnvironmentCache({
      cachePath: Path.join(home, "nested", "shell-environment.json"),
    });

    expect(cache.read()).toBeUndefined();
    cache.write('{"hello":"world"}\n');
    expect(cache.read()).toBe('{"hello":"world"}\n');
  });
});
