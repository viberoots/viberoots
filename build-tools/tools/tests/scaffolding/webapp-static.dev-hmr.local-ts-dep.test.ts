#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import * as fsp from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

async function pickFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  server.close();
  if (!addr || typeof addr !== "object" || typeof addr.port !== "number") {
    throw new Error("failed to reserve an ephemeral port");
  }
  return addr.port;
}

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

async function waitForHttpOk(url: string, timeoutMs = 45000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await httpGet(url);
      if (res.status === 200) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`server did not become ready within ${timeoutMs}ms`);
}

async function stopServer(child: ChildProcess): Promise<void> {
  try {
    if (child.pid) child.kill("SIGINT");
  } catch {}
  try {
    await Promise.race([once(child, "exit"), sleep(5000)]);
  } catch {}
  if (child.exitCode == null) {
    try {
      if (child.pid) child.kill("SIGKILL");
    } catch {}
  }
}

function viteFsUrlFor(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  return normalized.startsWith("/") ? `/@fs${normalized}` : `/@fs/${normalized}`;
}

function extractImportedUrl(moduleBody: string, includesNeedle: string): string {
  const importRe = /from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null = null;
  while (true) {
    const next = importRe.exec(moduleBody);
    if (!next) break;
    const spec = String(next[1] || "");
    if (spec.includes(includesNeedle)) {
      match = next;
      break;
    }
  }
  if (!match || !match[1]) {
    throw new Error(`failed to find imported module containing '${includesNeedle}'`);
  }
  return String(match[1]);
}

function toAbsoluteModuleUrl(baseUrl: string, maybeRelative: string): string {
  if (maybeRelative.startsWith("http://") || maybeRelative.startsWith("https://")) {
    return maybeRelative;
  }
  return new URL(maybeRelative, baseUrl).toString();
}

function esbuildPackageName(): string {
  const { platform, arch } = process;
  if (platform === "darwin")
    return arch === "arm64" ? "@esbuild/darwin-arm64" : "@esbuild/darwin-x64";
  if (platform === "linux") return arch === "arm64" ? "@esbuild/linux-arm64" : "@esbuild/linux-x64";
  if (platform === "win32") return arch === "arm64" ? "@esbuild/win32-arm64" : "@esbuild/win32-x64";
  return "";
}

test(
  "webapp-static scaffolds Phase-1 local dependency Vite contract",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-static-hmr-config", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "pipe" });
      await $`scaf new ts webapp-static demo-web --yes --no-tests`;
      const configPath = path.join(tmp, "projects", "apps", "demo-web", "vite.config.ts");
      const config = await fsp.readFile(configPath, "utf8");
      assert.match(config, /const workspaceRoot = path\.resolve\(appRoot, "\.\.\/\.\.\/\.\."\);/);
      assert.match(config, /server:\s*\{[\s\S]*fs:\s*\{[\s\S]*allow:\s*\[workspaceRoot\]/m);
      assert.match(config, /spec\.startsWith\("workspace:"\)/);
      assert.match(config, /spec\.startsWith\("link:"\)/);
      assert.match(config, /spec\.startsWith\("file:"\)/);
      assert.match(config, /optimizeDeps:\s*\{[\s\S]*exclude:\s*optimizeDepsExclude/m);
    });
  },
);

test(
  "webapp-static dev serves updated local TS dependency source without restart",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    process.env.NIX_PNPM_ALLOW_GENERATE = "1";
    process.env.NIX_PNPM_FETCH_TIMEOUT = process.env.NIX_PNPM_FETCH_TIMEOUT || "240";
    await runInTemp("webapp-static-hmr-local-dep", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-static demo-web --yes --no-tests`;
      await $`scaf new ts lib demo-lib --yes --no-tests`;

      const appAbs = path.join(tmp, "projects", "apps", "demo-web");
      const appMainPath = path.join(appAbs, "src", "main.ts");
      const libSourcePath = path.join(tmp, "projects", "libs", "demo-lib", "src", "index.ts");
      const libSourceFsPath = viteFsUrlFor(libSourcePath);
      const appMainSource = [
        'import { readWasmContractBytes } from "./wasm-contract";',
        'import { depMessage } from "../../../libs/demo-lib/src/index";',
        "",
        'const root = document.getElementById("app");',
        "if (root) {",
        "  root.textContent = `dep:${depMessage()}`;",
        "}",
        "",
        'document.addEventListener("DOMContentLoaded", () => {',
        '  const el = document.getElementById("app");',
        "  if (el) {",
        "    void readWasmContractBytes().then((bytes) => {",
        '      el.setAttribute("data-wasm-bytes", String(bytes.byteLength));',
        "    });",
        "  }",
        "});",
        "",
      ].join("\n");
      await fsp.writeFile(appMainPath, appMainSource, "utf8");
      await fsp.writeFile(
        libSourcePath,
        'export const depMessage = (): string => "phase1-a";\n',
        "utf8",
      );

      await _$({
        cwd: tmp,
        stdio: "pipe",
      })`git add -A projects/apps/demo-web projects/libs/demo-lib`;

      const outPathRaw = await _$({
        cwd: appAbs,
        stdio: "pipe",
      })`zx-wrapper ../../../build-tools/tools/dev/node-modules-build.ts`;
      const outPath = String(outPathRaw.stdout || "").trim();
      if (!outPath) throw new Error("failed to resolve node_modules derivation path");
      await _$({
        cwd: appAbs,
        stdio: "inherit",
      })`rm -rf node_modules && ln -s ${outPath}/node_modules node_modules`;

      const esbuildPkg = esbuildPackageName();
      const esbuildBin = esbuildPkg
        ? path.join(
            appAbs,
            "node_modules",
            esbuildPkg,
            "bin",
            process.platform === "win32" ? "esbuild.exe" : "esbuild",
          )
        : "";

      const port = await pickFreePort();
      const serverStdout: string[] = [];
      const serverStderr: string[] = [];
      const devServer = spawn(
        "node",
        [
          "./node_modules/vite/bin/vite.js",
          "dev",
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--strictPort",
          "--clearScreen",
          "false",
          "--logLevel",
          "info",
        ],
        {
          cwd: appAbs,
          stdio: "pipe",
          env: {
            ...process.env,
            NODE_ENV: "development",
            NODE_OPTIONS: "",
            ESBUILD_BINARY_PATH: esbuildBin,
          },
        },
      );
      devServer.stdout?.on("data", (chunk) => {
        serverStdout.push(String(chunk || ""));
        if (serverStdout.length > 100) serverStdout.shift();
      });
      devServer.stderr?.on("data", (chunk) => {
        serverStderr.push(String(chunk || ""));
        if (serverStderr.length > 100) serverStderr.shift();
      });

      try {
        await waitForHttpOk(`http://127.0.0.1:${port}/`);
        const mainModuleUrl = `http://127.0.0.1:${port}/src/main.ts`;
        const firstMainModule = await httpGet(mainModuleUrl);
        assert.equal(firstMainModule.status, 200);
        const firstDepSpec = extractImportedUrl(firstMainModule.body, "/demo-lib/src/index");
        const firstDepModuleUrl = toAbsoluteModuleUrl(mainModuleUrl, firstDepSpec);
        const firstModule = await httpGet(firstDepModuleUrl);
        assert.equal(firstModule.status, 200);
        assert.match(firstModule.body, /phase1-a/);
        assert.ok(firstDepModuleUrl.includes(libSourceFsPath));

        await fsp.writeFile(
          libSourcePath,
          'export const depMessage = (): string => "phase1-b";\n',
          "utf8",
        );
        const now = new Date();
        await fsp.utimes(libSourcePath, now, now);

        const start = Date.now();
        let observed = "";
        while (Date.now() - start < 60000) {
          if (devServer.exitCode != null) {
            throw new Error(
              `vite exited unexpectedly during dependency update (code=${devServer.exitCode})`,
            );
          }
          const currentMainModule = await httpGet(mainModuleUrl);
          if (currentMainModule.status !== 200) {
            await sleep(300);
            continue;
          }
          const currentDepSpec = extractImportedUrl(currentMainModule.body, "/demo-lib/src/index");
          const currentDepModuleUrl = toAbsoluteModuleUrl(mainModuleUrl, currentDepSpec);
          const nextModule = await httpGet(currentDepModuleUrl);
          if (nextModule.status === 200 && nextModule.body.includes("phase1-b")) {
            observed = nextModule.body;
            break;
          }
          await sleep(300);
        }
        if (!observed.includes("phase1-b")) {
          const tailOut = serverStdout.join("").slice(-6000);
          const tailErr = serverStderr.join("").slice(-6000);
          throw new Error(
            [
              "expected updated local dependency source to be served in the same dev session",
              `vite stdout tail:\n${tailOut}`,
              `vite stderr tail:\n${tailErr}`,
            ].join("\n\n"),
          );
        }
      } finally {
        await stopServer(devServer);
      }
    });
  },
);

after(() => {
  const code = (process as any).exitCode ?? 0;
  setImmediate(() => process.exit(code));
});
