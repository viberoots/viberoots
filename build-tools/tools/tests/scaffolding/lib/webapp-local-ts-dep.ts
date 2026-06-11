#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../../lib/test-helpers/run-in-temp";
import {
  evaluateRenderedAppText,
  extractImportedUrl,
  httpGet,
  moduleUrlResolvesToFile,
  pickFreePort,
  stopServer,
  toAbsoluteModuleUrl,
  waitForHttpOk,
} from "./webapp-static-hmr";
import {
  assertNoProcessRestart,
  assertWorkspaceLinkedDependency,
  esbuildPackageName,
  waitForValue,
  writeAndBumpMtime,
} from "./wasm-watch";

export async function runWebappLocalTsDependencyTest(options: {
  appName: string;
  tempName: string;
  template: "webapp-static" | "webapp-static-pwa";
}): Promise<void> {
  process.env.NIX_PNPM_ALLOW_GENERATE = "1";
  process.env.NIX_PNPM_FETCH_TIMEOUT = process.env.NIX_PNPM_FETCH_TIMEOUT || "240";
  await runInTemp(options.tempName, async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    await $`scaf new ts ${options.template} ${options.appName} --yes --no-tests --skip-lockfile-gen`;
    await $`scaf new ts lib demo-lib --yes --no-tests --skip-lockfile-gen`;

    const appAbs = path.join(tmp, "projects", "apps", options.appName);
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
    })`git add -A projects/apps/${options.appName} projects/libs/demo-lib`;
    await _$({
      cwd: tmp,
      stdio: "inherit",
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
    })`pnpm --dir ${tmp} install --filter ./projects/apps/${options.appName}... --no-frozen-lockfile --prefer-offline --ignore-scripts --reporter=append-only`;

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
    const serverLogs = () => `${serverStdout.join("")}\n${serverStderr.join("")}`;

    try {
      await waitForValue(
        async () => {
          assertNoProcessRestart(devServer, devServer.pid);
          return serverLogs();
        },
        (logs) => /\bready in\b|Local:/i.test(logs),
        60000,
      );
      await waitForHttpOk(`http://127.0.0.1:${port}/`);
      const mainModuleUrl = `http://127.0.0.1:${port}/src/main.ts`;
      let mainEvalSerial = 0;
      const evaluateMainText = async (): Promise<string> => {
        mainEvalSerial += 1;
        return await evaluateRenderedAppText(`${mainModuleUrl}?t=${Date.now()}-${mainEvalSerial}`, {
          cacheBustImports: true,
        });
      };
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
      const firstRenderedText = await evaluateMainText();
      assert.equal(firstRenderedText, "dep:phase1-a");
      const serverPid = devServer.pid;

      await writeAndBumpMtime(appMainPath, appMainLocalEditSource);
      const appLocalObserved = await waitForValue(
        async () => {
          assertNoProcessRestart(devServer, serverPid);
          return await evaluateMainText();
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
          return await evaluateMainText();
        },
        (v) => v === "dep:phase1-b|app:phase1-local",
        120000,
      );
      assert.equal(observed, "dep:phase1-b|app:phase1-local");

      const finalProbeToken = `${Date.now()}-${mainEvalSerial + 1}`;
      const currentMainModule = await httpGet(`${mainModuleUrl}?t=${finalProbeToken}`);
      assert.equal(currentMainModule.status, 200);
      const currentDepSpec = extractImportedUrl(currentMainModule.body, "/demo-lib");
      const currentDepModuleUrl = toAbsoluteModuleUrl(mainModuleUrl, currentDepSpec);
      const nextModule = await httpGet(`${currentDepModuleUrl}?__vbr_eval=${finalProbeToken}`);
      assert.equal(nextModule.status, 200);
      assert.match(nextModule.body, /phase1-b/);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const tailOut = serverStdout.join("").slice(-6000);
      const tailErr = serverStderr.join("").slice(-6000);
      throw new Error(
        [
          message,
          `[hmr-contract] temp=${tmp} app=${appAbs} pid=${String(devServer.pid || "")}`,
          `[hmr-contract] stdout tail:\n${tailOut}`,
          `[hmr-contract] stderr tail:\n${tailErr}`,
        ].join("\n"),
      );
    } finally {
      await stopServer(devServer);
    }
  });
}
