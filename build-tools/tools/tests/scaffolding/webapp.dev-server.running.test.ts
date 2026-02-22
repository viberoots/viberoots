#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import * as fsp from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { runInTemp } from "../lib/test-helpers.ts";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

async function httpGet(url: string): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { status } = await httpGet(url);
      if (status >= 200 && status < 500) return; // server is responding
    } catch {}
    await sleep(500);
  }
  throw new Error(`server did not respond within ${timeoutMs}ms`);
}

test("node webapp: dev server runs and serves index", { timeout: TEST_TIMEOUT_MS }, async () => {
  process.env.NIX_PNPM_ALLOW_GENERATE = "1";
  process.env.NIX_PNPM_FETCH_TIMEOUT = process.env.NIX_PNPM_FETCH_TIMEOUT || "240";
  await runInTemp("webapp-dev", async (tmp, _$) => {
    const name = "demo-web";
    const appDir = `projects/apps/${name}`;
    const appAbs = path.join(tmp, appDir);
    // Choose a free port programmatically to avoid both contention and reliance on Vite logs
    let chosenPort: number | undefined;

    await _$`scaf new ts webapp-static ${name} --yes`;
    // runInTemp initializes a git repo; stage generated files so Nix git-flake evaluation sees them.
    try {
      await _$({ cwd: tmp, stdio: "pipe" })`git add -A ${appDir}`;
    } catch {}
    // Ensure any pre-existing symlinked node_modules in the importer is removed
    try {
      const nmPath = path.join(appAbs, "node_modules");
      const st = await fsp.lstat(nmPath);
      if (st.isSymbolicLink()) {
        await fsp.unlink(nmPath);
      }
    } catch {}
    // Do not perform online pnpm install here. Rely on Nix FOD with
    // NIX_PNPM_ALLOW_GENERATE=1 to generate or use/export a lockfile hermetically.
    const outPathRaw = await _$({
      cwd: appAbs,
      stdio: "pipe",
    })`zx-wrapper ../../../build-tools/tools/dev/node-modules-build.ts`;
    try {
      await _$({ cwd: tmp, stdio: "pipe" })`git add -A ${appDir}`;
    } catch {}
    const outPath = String(outPathRaw.stdout || "").trim();
    if (!outPath) throw new Error("failed to resolve node_modules derivation path");
    await _$({
      cwd: appAbs,
      stdio: "inherit",
    })`rm -rf node_modules && ln -s ${outPath}/node_modules node_modules`;

    // Avoid duplicate node_modules rebuilds; one derivation link is sufficient for the dev server

    // Restore node_modules-based vite path
    // Resolve esbuild native binary path (postinstall scripts are disabled in Nix build)
    const esPkg = (() => {
      const plat = process.platform;
      const arch = process.arch;
      if (plat === "darwin")
        return arch === "arm64" ? "@esbuild/darwin-arm64" : "@esbuild/darwin-x64";
      if (plat === "linux") return arch === "arm64" ? "@esbuild/linux-arm64" : "@esbuild/linux-x64";
      if (plat === "win32") return arch === "arm64" ? "@esbuild/win32-arm64" : "@esbuild/win32-x64";
      return "";
    })();
    const esbuildBin = esPkg
      ? path.join(
          appAbs,
          "node_modules",
          esPkg,
          "bin",
          process.platform === "win32" ? "esbuild.exe" : "esbuild",
        )
      : "";

    // Smoke-check vite can execute and report a version (fast failure if resolution is broken)
    try {
      const ver = await _$({
        cwd: appAbs,
        stdio: "pipe",
        env: { ...process.env, NODE_OPTIONS: "", ESBUILD_BINARY_PATH: esbuildBin },
      })`node ./node_modules/vite/bin/vite.js --version`;
      // quiet
    } catch (e) {
      // surface concise failure
      console.error("vite --version failed:", e instanceof Error ? e.message : String(e));
      throw e;
    }

    // Preselect a free port deterministically
    {
      const srv = net.createServer();
      await new Promise<void>((resolve, reject) => {
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => resolve());
      });
      const addr = srv.address();
      if (typeof addr === "object" && addr && typeof addr.port === "number") {
        chosenPort = addr.port;
      }
      try {
        srv.close();
      } catch {}
      if (chosenPort === undefined) throw new Error("failed to acquire a free port");
    }

    // Start Vite dev server with retry on rare bind races; enforce strict port to avoid silent port changes
    let out = "";
    let err = "";
    let server = spawn(
      "node",
      [
        "./node_modules/vite/bin/vite.js",
        "dev",
        "--host",
        "127.0.0.1",
        "--port",
        String(chosenPort),
        "--strictPort",
        "--clearScreen",
        "false",
        "--logLevel",
        "info",
      ],
      {
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "development",
          NODE_OPTIONS: "",
          // Help the esbuild npm package find a native binary without running postinstall
          ESBUILD_BINARY_PATH: esbuildBin,
        },
        cwd: appAbs,
      },
    );
    const tryExtractPort = (s: string) => {
      // No-op; we now select the port explicitly. Keep function to retain minimal overhead.
      return;
    };

    server.stdout?.on("data", (d) => {
      const s = String(d);
      out += s;
      if (out.length > 200000) out = out.slice(-200000);
      tryExtractPort(s);
      // Surface logs only when verbose to reduce event-loop pressure in suite runs
      if (process.env.TEST_VERBOSE_LOGS === "1") {
        try {
          console.log("[vite stdout]" + "\n" + s.trimEnd());
        } catch {}
      }
    });
    server.stderr?.on("data", (d) => {
      const s = String(d);
      err += s;
      if (err.length > 200000) err = err.slice(-200000);
      tryExtractPort(s);
      if (process.env.TEST_VERBOSE_LOGS === "1") {
        try {
          console.error("[vite stderr]" + "\n" + s.trimEnd());
        } catch {}
      }
    });
    server.on("exit", (code, signal) => {
      try {
        console.error(`[vite exit] code=${code} signal=${signal || ""}`);
      } catch {}
    });

    try {
      // Server should bind to the preselected port; wait for readiness, retrying on early exit (e.g., EADDRINUSE)
      let ready = false;
      for (let attempt = 0; attempt < 3 && !ready; attempt++) {
        const exitPromise = once(server, "exit").then(([code, signal]) => {
          throw new Error(`vite exited before ready (code=${code}, signal=${signal || ""})`);
        });
        try {
          await Promise.race([
            // Reduce per-attempt budget to keep total under the 240s test cap
            waitForServer(`http://127.0.0.1:${chosenPort}/`, 45000),
            exitPromise,
          ]);
          ready = true;
        } catch (e) {
          // If vite exited early, retry with a new free port
          try {
            server.stdout?.removeAllListeners();
            server.stderr?.removeAllListeners();
            server.kill("SIGKILL");
          } catch {}
          if (attempt === 2) {
            console.error(
              "webapp dev-server: Vite did not become ready within the allotted time — rerun with TEST_VERBOSE_LOGS=1 to inspect logs; ensure node-modules was realized and ESBUILD_BINARY_PATH is set",
            );
            throw e;
          }
          // Acquire a new port and restart vite with strictPort
          const srv = net.createServer();
          await new Promise<void>((resolve, reject) => {
            srv.once("error", reject);
            srv.listen(0, "127.0.0.1", () => resolve());
          });
          const addr = srv.address();
          let newPort: number | undefined;
          if (typeof addr === "object" && addr && typeof addr.port === "number") {
            newPort = addr.port;
          }
          try {
            srv.close();
          } catch {}
          if (!newPort) throw new Error("failed to acquire a free port on retry");
          chosenPort = newPort;
          // Restart
          server = spawn(
            "node",
            [
              "./node_modules/vite/bin/vite.js",
              "dev",
              "--host",
              "127.0.0.1",
              "--port",
              String(chosenPort),
              "--strictPort",
              "--clearScreen",
              "false",
              "--logLevel",
              "info",
            ],
            {
              stdio: "pipe",
              env: {
                ...process.env,
                NODE_ENV: "development",
                NODE_OPTIONS: "",
                ESBUILD_BINARY_PATH: esbuildBin,
              },
              cwd: appAbs,
            },
          );
          // Rewire listeners for new server
          server.stdout?.on("data", (d) => {
            const s = String(d);
            out += s;
            if (out.length > 200000) out = out.slice(-200000);
            tryExtractPort(s);
            if (process.env.TEST_VERBOSE_LOGS === "1") {
              try {
                console.log("[vite stdout]" + "\n" + s.trimEnd());
              } catch {}
            }
          });
          server.stderr?.on("data", (d) => {
            const s = String(d);
            err += s;
            if (err.length > 200000) err = err.slice(-200000);
            tryExtractPort(s);
            if (process.env.TEST_VERBOSE_LOGS === "1") {
              try {
                console.error("[vite stderr]" + "\n" + s.trimEnd());
              } catch {}
            }
          });
          server.on("exit", (code, signal) => {
            try {
              console.error(`[vite exit] code=${code} signal=${signal || ""}`);
            } catch {}
          });
        }
      }
      let status = 0;
      let body = "";
      try {
        const res = await httpGet(`http://127.0.0.1:${chosenPort}/`);
        status = res.status;
        body = res.body;
      } catch {
        // Ignore; status/body remain defaults to trigger assertion below
      }
      assert.equal(status, 200);
      // Minimal sanity: served HTML; template includes "Hello <name>" in index.html
      assert.ok(body.includes("<!doctype html>") || body.includes(`Hello ${name}`));
    } finally {
      if (out && process.env.TEST_VERBOSE_LOGS === "1") console.log("[dev stdout]\n" + out);
      if (err && process.env.TEST_VERBOSE_LOGS === "1") console.error("[dev stderr]\n" + err);
      // Graceful shutdown
      try {
        server.kill("SIGINT");
      } catch {}
      // Wait for child to actually exit to avoid open handle leaks in node:test
      try {
        await Promise.race([once(server, "exit"), sleep(5000)]);
      } catch {}
      try {
        server.stdout?.removeAllListeners();
        server.stderr?.removeAllListeners();
        server.stdin?.destroy();
        server.stdout?.destroy();
        server.stderr?.destroy();
      } catch {}
      // Best-effort hard kill if still around
      if (!server.killed) {
        try {
          server.kill("SIGKILL");
        } catch {}
      }
      // Ensure HTTP keep-alive sockets don't keep the event loop open
      try {
        (http as any).globalAgent?.destroy?.();
      } catch {}
    }
  });
});

// Ensure the process exits promptly after subtests finish to avoid file-level timeouts due to
// lingering handles from external tools. Preserve Node's computed exitCode.
after(() => {
  const code = (process as any).exitCode ?? 0;
  setImmediate(() => process.exit(code));
});
