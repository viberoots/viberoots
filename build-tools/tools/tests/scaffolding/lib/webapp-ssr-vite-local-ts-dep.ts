import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeLibSource } from "./next-dev";
import { evaluateRenderedAppText, httpGet, pickFreePort, stopServer } from "./webapp-static-hmr";
import {
  assertNoProcessRestart,
  assertWorkspaceLinkedDependency,
  waitForConsecutive,
  waitForValue,
  writeAndBumpMtime,
} from "./wasm-watch";

export async function runSsrViteLocalTsDepTest(tmp: string, _$: any): Promise<void> {
  const $ = _$({ cwd: tmp, stdio: "inherit" });
  await $`scaf new ts webapp-ssr-vite demo-vite-ssr --yes --no-tests --skip-lockfile-gen`;
  await $`scaf new ts lib demo-lib --yes --no-tests --skip-lockfile-gen`;

  const appAbs = path.join(tmp, "projects", "apps", "demo-vite-ssr");
  const appEntryClientPath = path.join(appAbs, "src", "entry-client.ts");
  const appEntryServerPath = path.join(appAbs, "src", "entry-server.ts");
  const appPackageJsonPath = path.join(appAbs, "package.json");
  const libPackageJsonPath = path.join(tmp, "projects", "libs", "demo-lib", "package.json");
  const libSourcePath = path.join(tmp, "projects", "libs", "demo-lib", "src", "index.ts");
  const clientEntrySource = [
    'import { depClientMessage } from "@libs/demo-lib";',
    "",
    'const root = document.getElementById("app");',
    "if (root) {",
    "  root.textContent = `client:${depClientMessage()}`;",
    "}",
    "",
  ].join("\n");
  const serverEntrySource = [
    'import { depServerMessage } from "@libs/demo-lib";',
    "",
    "export function render(url: string): string {",
    '  const safeUrl = url.replace(/"/g, "&quot;");',
    '  return `<main id="app" data-ssr-marker="vite">server:${depServerMessage()} at ${safeUrl}</main>`;',
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

  await fsp.writeFile(appEntryClientPath, clientEntrySource, "utf8");
  await fsp.writeFile(appEntryServerPath, serverEntrySource, "utf8");
  await fsp.writeFile(libSourcePath, writeLibSource("client-a", "server-a"), "utf8");

  await _$({
    cwd: tmp,
    stdio: "pipe",
  })`git add -A projects/apps/demo-vite-ssr projects/libs/demo-lib`;

  await _$({
    cwd: tmp,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
  })`pnpm install --filter ./projects/apps/demo-vite-ssr... --no-frozen-lockfile --prefer-offline --ignore-scripts --reporter=append-only`;

  const port = await pickFreePort();
  const serverStdout: string[] = [];
  const serverStderr: string[] = [];
  const devServer: ChildProcess = spawn("pnpm", ["run", "dev:ssr"], {
    cwd: appAbs,
    stdio: "pipe",
    env: {
      ...process.env,
      PORT: String(port),
      NODE_OPTIONS: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  devServer.stdout?.on("data", (chunk) => {
    serverStdout.push(String(chunk || ""));
    if (serverStdout.length > 100) serverStdout.shift();
  });
  devServer.stderr?.on("data", (chunk) => {
    serverStderr.push(String(chunk || ""));
    if (serverStderr.length > 100) serverStderr.shift();
  });

  const assertDevServerAlive = (phase: string): void => {
    if (devServer.exitCode != null) {
      throw new Error(
        `dev server exited during ${phase} (exitCode=${String(
          devServer.exitCode,
        )}, signal=${String(devServer.signalCode)})`,
      );
    }
  };

  try {
    const mainModuleUrl = `http://127.0.0.1:${port}/src/entry-client.ts`;
    const initialClient = await waitForValue(
      async () => {
        assertDevServerAlive("client startup");
        return await evaluateRenderedAppText(mainModuleUrl);
      },
      (value) => value === "client:client-a",
      150000,
      250,
    );
    assert.equal(initialClient, "client:client-a");

    const initialServer = await waitForValue(
      async () => {
        assertDevServerAlive("SSR startup");
        return await httpGet(`http://127.0.0.1:${port}/`);
      },
      (res) => res.status === 200 && res.body.includes("server:server-a at /"),
      150000,
      250,
    );
    assert.equal(initialServer.status, 200);
    assert.match(initialServer.body, /server:server-a at \//);

    const serverPid = devServer.pid;

    await writeAndBumpMtime(libSourcePath, writeLibSource("client-b", "server-a"));

    const clientUpdated = await waitForValue(
      async () => {
        assertDevServerAlive("client update");
        return await evaluateRenderedAppText(mainModuleUrl);
      },
      (v) => v === "client:client-b",
      120000,
      250,
    );
    assert.equal(clientUpdated, "client:client-b");
    assertNoProcessRestart(devServer, serverPid);

    await waitForConsecutive(
      () => {
        assertDevServerAlive("client stability check");
        return evaluateRenderedAppText(mainModuleUrl).then((v) => v === "client:client-b");
      },
      2,
      120000,
      250,
    );

    await writeAndBumpMtime(libSourcePath, writeLibSource("client-b", "server-b"));

    const serverUpdated = await waitForValue(
      async () => {
        assertDevServerAlive("server update");
        return await httpGet(`http://127.0.0.1:${port}/`);
      },
      (res) => res.status === 200 && res.body.includes("server:server-b at /"),
      120000,
      250,
    );
    assert.equal(serverUpdated.status, 200);
    assert.match(serverUpdated.body, /server:server-b at \//);
    assertNoProcessRestart(devServer, serverPid);
  } catch (error) {
    const tailOut = serverStdout.join("").slice(-6000);
    const tailErr = serverStderr.join("").slice(-6000);
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        `vite stdout tail:\n${tailOut}`,
        `vite stderr tail:\n${tailErr}`,
      ].join("\n\n"),
    );
  } finally {
    await stopServer(devServer);
  }
}
