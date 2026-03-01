#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import {
  evaluateRenderedAppText,
  extractImportedUrl,
  httpGet,
  moduleUrlResolvesToFile,
  pickFreePort,
  stopServer,
  toAbsoluteModuleUrl,
  waitForHttpOk,
} from "./lib/webapp-static-hmr";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

function esbuildPackageName(): string {
  const { platform, arch } = process;
  if (platform === "darwin")
    return arch === "arm64" ? "@esbuild/darwin-arm64" : "@esbuild/darwin-x64";
  if (platform === "linux") return arch === "arm64" ? "@esbuild/linux-arm64" : "@esbuild/linux-x64";
  if (platform === "win32") return arch === "arm64" ? "@esbuild/win32-arm64" : "@esbuild/win32-x64";
  return "";
}

async function waitForValue<T>(
  getter: () => Promise<T>,
  check: (value: T) => boolean,
  timeoutMs = 120000,
): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < timeoutMs) {
    last = await getter();
    if (check(last)) return last;
    await sleep(300);
  }
  throw new Error(
    `timed out waiting for expected value after ${timeoutMs}ms (last=${String(last ?? "")})`,
  );
}

test(
  "webapp-static scaffolds Phase-1 local dependency Vite contract",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-static-hmr-config", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "pipe" });
      await $`scaf new ts webapp-static demo-web --yes --no-tests`;
      const configPath = path.join(tmp, "projects", "apps", "demo-web", "vite.config.ts");
      const packageJsonPath = path.join(tmp, "projects", "apps", "demo-web", "package.json");
      const wasmContractPath = path.join(
        tmp,
        "projects",
        "apps",
        "demo-web",
        "src",
        "wasm-contract.ts",
      );
      const config = await fsp.readFile(configPath, "utf8");
      const packageJson = await fsp.readFile(packageJsonPath, "utf8");
      const wasmContract = await fsp.readFile(wasmContractPath, "utf8");
      assert.match(config, /const workspaceRoot = path\.resolve\(appRoot, "\.\.\/\.\.\/\.\."\);/);
      assert.match(config, /server:\s*\{[\s\S]*fs:\s*\{[\s\S]*allow:\s*\[workspaceRoot\]/m);
      assert.match(config, /spec\.startsWith\("workspace:"\)/);
      assert.match(config, /spec\.startsWith\("link:"\)/);
      assert.match(config, /spec\.startsWith\("file:"\)/);
      assert.match(config, /optimizeDeps:\s*\{[\s\S]*exclude:\s*optimizeDepsExclude/m);
      assert.match(packageJson, /"dev:wasm:watch"/);
      assert.match(packageJson, /watch-wasm-producer\.ts/);
      assert.match(packageJson, /"dev":\s*"zx-wrapper .*dev-with-wasm-watch\.ts/);
      assert.match(wasmContract, /\.\/wasm-contract\/top\.wasm/);
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
      const appMainSource = [
        'import { depMessage } from "../../../libs/demo-lib/src/index";',
        "",
        'const root = document.getElementById("app");',
        "if (root) {",
        "  root.textContent = `dep:${depMessage()}`;",
        "}",
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
        const resolvesToSource = await moduleUrlResolvesToFile(firstDepModuleUrl, libSourcePath);
        assert.equal(
          resolvesToSource,
          true,
          `expected dependency module URL to resolve to source file ${libSourcePath}, got ${firstDepModuleUrl}`,
        );
        const firstRenderedText = await evaluateRenderedAppText(mainModuleUrl);
        assert.equal(firstRenderedText, "dep:phase1-a");

        await fsp.writeFile(
          libSourcePath,
          'export const depMessage = (): string => "phase1-b";\n',
          "utf8",
        );
        const now = new Date();
        await fsp.utimes(libSourcePath, now, now);

        const observed = await waitForValue(
          async () => {
            if (devServer.exitCode != null) {
              throw new Error(
                `vite exited unexpectedly during dependency update (code=${devServer.exitCode})`,
              );
            }
            return await evaluateRenderedAppText(mainModuleUrl);
          },
          (v) => v === "dep:phase1-b",
        );
        assert.equal(observed, "dep:phase1-b");

        // Verify the served dependency module source also advanced, not just DOM text.
        const currentMainModule = await httpGet(mainModuleUrl);
        assert.equal(currentMainModule.status, 200);
        const currentDepSpec = extractImportedUrl(currentMainModule.body, "/demo-lib/src/index");
        const currentDepModuleUrl = toAbsoluteModuleUrl(mainModuleUrl, currentDepSpec);
        const nextModule = await httpGet(currentDepModuleUrl);
        assert.equal(nextModule.status, 200);
        assert.match(nextModule.body, /phase1-b/);
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
