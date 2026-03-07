#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { readClientProbeText, writeLibSource } from "./lib/next-dev";
import {
  assertNoProcessRestart,
  assertWorkspaceLinkedDependency,
  waitForValue,
  writeAndBumpMtime,
} from "./lib/wasm-watch";
import { httpGet, pickFreePort, stopServer, waitForHttpOk } from "./lib/webapp-static-hmr";
const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;
const NEXT_DEV_UPDATE_TIMEOUT_MS = Number(process.env.NEXT_DEV_UPDATE_TIMEOUT_MS || "120000");
const NEXT_DEV_POLL_MS = 1000;

function clientProbeSource(labelPrefix: string): string {
  return [
    '"use client";',
    "",
    'import { depClientMessage } from "@libs/demo-lib";',
    "",
    "export function ClientProbe() {",
    `  return <p id="client-probe">{\`${labelPrefix}:\${depClientMessage()}\`}</p>;`,
    "}",
    "",
  ].join("\n");
}

test(
  "webapp-ssr-next scaffolds Phase-1 local dependency dev contract",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-ssr-next-hmr-config", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "pipe" });
      await $`scaf new ts webapp-ssr-next demo-next-ssr --yes --no-tests --skip-lockfile-gen`;
      const configPath = path.join(tmp, "projects", "apps", "demo-next-ssr", "next.config.mjs");
      const config = await fsp.readFile(configPath, "utf8");
      assert.match(config, /spec\.startsWith\("workspace:"\)/);
      assert.match(config, /spec\.startsWith\("link:"\)/);
      assert.match(config, /spec\.startsWith\("file:"\)/);
      assert.match(config, /transpilePackages/);
      assert.match(config, /externalDir:\s*true/);
      assert.match(config, /webpackDevMiddleware/);
      assert.match(config, /poll:\s*LOCAL_DEPS_WATCH_POLL_MS/);
    });
  },
);

test(
  "webapp-ssr-next dev applies local TS dependency edits for client and server paths",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-ssr-next-hmr-local-dep", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-ssr-next demo-next-ssr --yes --no-tests --skip-lockfile-gen`;
      await $`scaf new ts lib demo-lib --yes --no-tests --skip-lockfile-gen`;

      const appAbs = path.join(tmp, "projects", "apps", "demo-next-ssr");
      const appPagePath = path.join(appAbs, "app", "page.tsx");
      const appClientProbePath = path.join(appAbs, "app", "client-probe.tsx");
      const appPackageJsonPath = path.join(appAbs, "package.json");
      const libPackageJsonPath = path.join(tmp, "projects", "libs", "demo-lib", "package.json");
      const libSourcePath = path.join(tmp, "projects", "libs", "demo-lib", "src", "index.ts");
      const pageSource = [
        'import { depClientMessage, depServerMessage } from "@libs/demo-lib";',
        'import { ClientProbe } from "./client-probe";',
        "",
        'export const dynamic = "force-dynamic";',
        "",
        "export default function HomePage() {",
        "  return (",
        '    <main data-ssr-marker="next">',
        "      <h1>Hello from Next SSR</h1>",
        "      <ClientProbe />",
        '      <p id="server-client-probe">{`server-client:${depClientMessage()}`}</p>',
        '      <p id="server-probe">{`server:${depServerMessage()}`}</p>',
        "    </main>",
        "  );",
        "}",
        "",
      ].join("\n");
      const appLocalEditedPageSource = pageSource.replace(
        "Hello from Next SSR",
        "Hello from Next SSR local-edit",
      );
      const initialClientProbeSource = clientProbeSource("client");

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
      await fsp.writeFile(appPagePath, pageSource, "utf8");
      await fsp.writeFile(appClientProbePath, initialClientProbeSource, "utf8");
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
      await fsp.writeFile(libSourcePath, writeLibSource("client-a", "server-a"), "utf8");

      await _$({
        cwd: tmp,
        stdio: "pipe",
      })`git add -A projects/apps/demo-next-ssr projects/libs/demo-lib`;
      await _$({
        cwd: tmp,
        stdio: "inherit",
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
      })`pnpm install --filter ./projects/apps/demo-next-ssr... --no-frozen-lockfile --prefer-offline --ignore-scripts --reporter=append-only`;

      const port = await pickFreePort();
      const serverStdout: string[] = [];
      const serverStderr: string[] = [];
      const devServer: ChildProcess = spawn(
        "pnpm",
        ["exec", "next", "dev", "-H", "127.0.0.1", "-p", String(port)],
        {
          cwd: appAbs,
          stdio: "pipe",
          env: {
            ...process.env,
            PORT: String(port),
            NODE_OPTIONS: "",
            NEXT_TELEMETRY_DISABLED: "1",
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

      const pageUrl = `http://127.0.0.1:${port}/`;
      let pollStep = 0;
      const freshPageUrl = () => `${pageUrl}?v=${++pollStep}`;
      let stage = "boot";
      try {
        stage = "wait-for-http-ok";
        await waitForHttpOk(pageUrl, NEXT_DEV_UPDATE_TIMEOUT_MS);
        stage = "initial-server-render";
        const initialPage = await httpGet(freshPageUrl());
        assert.equal(initialPage.status, 200);
        assert.match(initialPage.body, /server-client:client-a/);
        assert.match(initialPage.body, /server:server-a/);

        stage = "initial-client-probe";
        const initialClientProbe = await waitForValue(
          async () => await readClientProbeText(freshPageUrl()),
          (value) => String(value || "").includes("client:client-a"),
          NEXT_DEV_UPDATE_TIMEOUT_MS,
          NEXT_DEV_POLL_MS,
        );
        assert.equal(String(initialClientProbe || "").includes("client:client-a"), true);

        const serverPid = devServer.pid;
        await writeAndBumpMtime(appPagePath, appLocalEditedPageSource);
        stage = "app-local-page-edit";
        const appLocalPageUpdated = await waitForValue(
          async () => await httpGet(freshPageUrl()),
          (res) => res.status === 200 && res.body.includes("Hello from Next SSR local-edit"),
          NEXT_DEV_UPDATE_TIMEOUT_MS,
          NEXT_DEV_POLL_MS,
        );
        assert.equal(appLocalPageUpdated.status, 200);
        assert.match(appLocalPageUpdated.body, /Hello from Next SSR local-edit/);
        assertNoProcessRestart(devServer, serverPid);

        await writeAndBumpMtime(libSourcePath, writeLibSource("client-b", "server-a"));

        stage = "workspace-client-dep-edit";
        const clientDepUpdated = await waitForValue(
          async () => await httpGet(freshPageUrl()),
          (res) => res.status === 200 && res.body.includes("server-client:client-b"),
          NEXT_DEV_UPDATE_TIMEOUT_MS,
          NEXT_DEV_POLL_MS,
        );
        assert.equal(clientDepUpdated.status, 200);
        assert.match(clientDepUpdated.body, /server-client:client-b/);
        assertNoProcessRestart(devServer, serverPid);

        await writeAndBumpMtime(libSourcePath, writeLibSource("client-b", "server-b"));

        stage = "workspace-server-dep-edit";
        const serverUpdated = await waitForValue(
          async () => await httpGet(freshPageUrl()),
          (res) => res.status === 200 && res.body.includes("server:server-b"),
          NEXT_DEV_UPDATE_TIMEOUT_MS,
          NEXT_DEV_POLL_MS,
        );
        assert.equal(serverUpdated.status, 200);
        assert.match(serverUpdated.body, /server:server-b/);
        assertNoProcessRestart(devServer, serverPid);
      } catch (error) {
        const tailOut = serverStdout.join("").slice(-6000);
        const tailErr = serverStderr.join("").slice(-6000);
        const lastProbe = await readClientProbeText(freshPageUrl()).catch(() => null);
        throw new Error(
          [
            error instanceof Error ? error.message : String(error),
            `failure stage: ${stage}`,
            `last client-probe: ${String(lastProbe ?? "<null>")}`,
            `next stdout tail:\n${tailOut}`,
            `next stderr tail:\n${tailErr}`,
          ].join("\n\n"),
        );
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
