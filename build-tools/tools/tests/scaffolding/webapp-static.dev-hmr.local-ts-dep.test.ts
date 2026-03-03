#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
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
import {
  assertNoProcessRestart,
  assertWorkspaceLinkedDependency,
  esbuildPackageName,
  waitForValue,
  writeAndBumpMtime,
} from "./lib/wasm-watch";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

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
      const appPackageJsonPath = path.join(appAbs, "package.json");
      const libPackageJsonPath = path.join(tmp, "projects", "libs", "demo-lib", "package.json");
      const libSourcePath = path.join(tmp, "projects", "libs", "demo-lib", "src", "index.ts");
      const appMainSource = [
        'import { depMessage } from "@libs/demo-lib";',
        "",
        'const root = document.getElementById("app");',
        "if (root) {",
        "  root.textContent = `dep:${depMessage()}`;",
        "}",
        "",
      ].join("\n");
      const appMainLocalEditSource = appMainSource.replace(
        "  root.textContent = `dep:${depMessage()}`;",
        "  root.textContent = `dep:${depMessage()}|app:phase1-local`;",
      );
      const appPackageJson = JSON.parse(await fsp.readFile(appPackageJsonPath, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      const libPackageJson = JSON.parse(await fsp.readFile(libPackageJsonPath, "utf8")) as Record<
        string,
        unknown
      >;
      const nextAppPackageJson = {
        ...appPackageJson,
        dependencies: {
          ...(appPackageJson.dependencies || {}),
          "@libs/demo-lib": "workspace:*",
        },
      };
      const nextLibPackageJson = {
        ...libPackageJson,
        exports: {
          ".": {
            default: "./src/index.ts",
          },
        },
        types: "./src/index.ts",
      };
      await fsp.writeFile(
        appPackageJsonPath,
        JSON.stringify(nextAppPackageJson, null, 2) + "\n",
        "utf8",
      );
      await fsp.writeFile(
        libPackageJsonPath,
        JSON.stringify(nextLibPackageJson, null, 2) + "\n",
        "utf8",
      );
      assertWorkspaceLinkedDependency(nextAppPackageJson.dependencies, "@libs/demo-lib");
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
      await _$({
        cwd: tmp,
        stdio: "inherit",
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
      })`pnpm install --filter ./projects/apps/demo-web --filter ./projects/libs/demo-lib --no-frozen-lockfile --ignore-scripts --reporter=append-only`;

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
        "pnpm",
        [
          "exec",
          "vite",
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
        const firstDepSpec = extractImportedUrl(firstMainModule.body, "/demo-lib");
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
        const serverPid = devServer.pid;

        await writeAndBumpMtime(appMainPath, appMainLocalEditSource);
        const appLocalObserved = await waitForValue(
          async () => {
            assertNoProcessRestart(devServer, serverPid);
            return await evaluateRenderedAppText(mainModuleUrl);
          },
          (v) => v === "dep:phase1-a|app:phase1-local",
          120000,
        );
        assert.equal(appLocalObserved, "dep:phase1-a|app:phase1-local");

        await writeAndBumpMtime(
          libSourcePath,
          'export const depMessage = (): string => "phase1-b";\n',
        );

        const observed = await waitForValue(
          async () => {
            assertNoProcessRestart(devServer, serverPid);
            return await evaluateRenderedAppText(mainModuleUrl);
          },
          (v) => v === "dep:phase1-b|app:phase1-local",
          120000,
        );
        assert.equal(observed, "dep:phase1-b|app:phase1-local");

        // Verify the served dependency module source also advanced, not just DOM text.
        const currentMainModule = await httpGet(mainModuleUrl);
        assert.equal(currentMainModule.status, 200);
        const currentDepSpec = extractImportedUrl(currentMainModule.body, "/demo-lib");
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
