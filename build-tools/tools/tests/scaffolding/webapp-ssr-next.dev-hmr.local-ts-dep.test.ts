#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { httpGet, pickFreePort, stopServer, waitForHttpOk } from "./lib/webapp-static-hmr";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

function writeLibSource(clientValue: string, serverValue: string): string {
  return [
    `export const depClientMessage = (): string => "${clientValue}";`,
    `export const depServerMessage = (): string => "${serverValue}";`,
    "",
  ].join("\n");
}

async function waitForValue<T>(
  getter: () => Promise<T>,
  check: (value: T) => boolean,
  timeoutMs = 90000,
): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < timeoutMs) {
    last = await getter();
    if (check(last)) return last;
    await sleep(300);
  }
  throw new Error(`timed out waiting for expected value after ${timeoutMs}ms`);
}

function extractAssetUrls(html: string, baseUrl: string): string[] {
  const scriptRe = /<script[^>]*\ssrc="([^"]+)"[^>]*>/g;
  const urls: string[] = [];
  while (true) {
    const next = scriptRe.exec(html);
    if (!next) break;
    const src = String(next[1] || "").trim();
    if (!src) continue;
    urls.push(new URL(src, baseUrl).toString());
  }
  return urls;
}

async function clientAssetsContain(pageUrl: string, needle: string): Promise<boolean> {
  const page = await httpGet(pageUrl);
  if (page.status !== 200) return false;
  const assets = extractAssetUrls(page.body, pageUrl).filter((url) =>
    url.includes("/_next/static/"),
  );
  for (const assetUrl of assets) {
    const res = await httpGet(assetUrl);
    if (res.status === 200 && res.body.includes(needle)) return true;
  }
  return false;
}

test(
  "webapp-ssr-next scaffolds Phase-1 local dependency dev contract",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-ssr-next-hmr-config", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "pipe" });
      await $`scaf new ts webapp-ssr-next demo-next-ssr --yes --no-tests`;
      const configPath = path.join(tmp, "projects", "apps", "demo-next-ssr", "next.config.mjs");
      const config = await fsp.readFile(configPath, "utf8");
      assert.match(config, /spec\.startsWith\("workspace:"\)/);
      assert.match(config, /spec\.startsWith\("link:"\)/);
      assert.match(config, /spec\.startsWith\("file:"\)/);
      assert.match(config, /transpilePackages/);
      assert.match(config, /externalDir:\s*true/);
    });
  },
);

test(
  "webapp-ssr-next dev applies local TS dependency edits for client and server paths",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-ssr-next-hmr-local-dep", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-ssr-next demo-next-ssr --yes --no-tests`;
      await $`scaf new ts lib demo-lib --yes --no-tests`;

      const appAbs = path.join(tmp, "projects", "apps", "demo-next-ssr");
      const appPagePath = path.join(appAbs, "app", "page.tsx");
      const appClientProbePath = path.join(appAbs, "app", "client-probe.tsx");
      const appPackageJsonPath = path.join(appAbs, "package.json");
      const libPackageJsonPath = path.join(tmp, "projects", "libs", "demo-lib", "package.json");
      const libSourcePath = path.join(tmp, "projects", "libs", "demo-lib", "src", "index.ts");
      const pageSource = [
        'import { depServerMessage } from "@libs/demo-lib";',
        'import { ClientProbe } from "./client-probe";',
        "",
        "export default function HomePage() {",
        "  return (",
        '    <main data-ssr-marker="next">',
        "      <h1>Hello from Next SSR</h1>",
        "      <ClientProbe />",
        '      <p id="server-probe">{`server:${depServerMessage()}`}</p>',
        "    </main>",
        "  );",
        "}",
        "",
      ].join("\n");
      const clientProbeSource = [
        '"use client";',
        "",
        'import { depClientMessage } from "@libs/demo-lib";',
        "",
        "export function ClientProbe() {",
        '  return <p id="client-probe">{`client:${depClientMessage()}`}</p>;',
        "}",
        "",
      ].join("\n");

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
      await fsp.writeFile(appClientProbePath, clientProbeSource, "utf8");
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
      await fsp.writeFile(libSourcePath, writeLibSource("client-a", "server-a"), "utf8");

      await _$({
        cwd: tmp,
        stdio: "pipe",
      })`git add -A projects/apps/demo-next-ssr projects/libs/demo-lib`;
      await _$({
        cwd: tmp,
        stdio: "inherit",
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
      })`pnpm install --filter ./projects/apps/demo-next-ssr --filter ./projects/libs/demo-lib --no-frozen-lockfile --ignore-scripts --reporter=append-only`;

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
      try {
        await waitForHttpOk(pageUrl, 90000);
        const initialPage = await httpGet(pageUrl);
        assert.equal(initialPage.status, 200);
        assert.match(initialPage.body, /server:server-a/);

        const initialClientProbe = await clientAssetsContain(pageUrl, "client-a");
        assert.equal(initialClientProbe, true);

        const serverPid = devServer.pid;
        await fsp.writeFile(libSourcePath, writeLibSource("client-b", "server-a"), "utf8");
        const now = new Date();
        await fsp.utimes(libSourcePath, now, now);

        const clientProbeUpdated = await waitForValue(
          async () => await clientAssetsContain(pageUrl, "client-b"),
          (value) => value,
        );
        assert.equal(clientProbeUpdated, true);
        assert.equal(devServer.exitCode, null);
        assert.equal(devServer.pid, serverPid);

        await fsp.writeFile(libSourcePath, writeLibSource("client-b", "server-b"), "utf8");
        const later = new Date();
        await fsp.utimes(libSourcePath, later, later);

        const serverUpdated = await waitForValue(
          async () => await httpGet(pageUrl),
          (res) => res.status === 200 && res.body.includes("server:server-b"),
        );
        assert.equal(serverUpdated.status, 200);
        assert.match(serverUpdated.body, /server:server-b/);
        assert.equal(devServer.exitCode, null);
        assert.equal(devServer.pid, serverPid);
      } catch (error) {
        const tailOut = serverStdout.join("").slice(-6000);
        const tailErr = serverStderr.join("").slice(-6000);
        throw new Error(
          [
            error instanceof Error ? error.message : String(error),
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
