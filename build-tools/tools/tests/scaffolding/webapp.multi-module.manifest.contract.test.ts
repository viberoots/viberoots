#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import {
  parseTsModuleManifest,
  parseWasmModuleManifest,
} from "../../scaffolding/webapp-module-manifests.ts";
import { runInTemp } from "../lib/test-helpers";
import { httpGet, pickFreePort, stopServer, waitForHttpOk } from "./lib/webapp-static-hmr";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test("webapp multi-module manifest schemas validate deterministic contracts", () => {
  const validWasm = parseWasmModuleManifest(
    {
      defaultModuleKey: "one",
      modules: [
        {
          moduleKey: "one",
          sourcePath: "src/wasm-contract/top.wasm",
          runtimeDestinations: {
            client: "client/top.wasm",
            server: "server/wasm-contract/top.wasm",
          },
        },
        {
          moduleKey: "two",
          sourcePath: "src/wasm-contract/alt.wasm",
          runtimeDestinations: {
            client: "client/alt.wasm",
            server: "server/wasm-contract/alt.wasm",
          },
        },
      ],
    },
    "wasm-valid",
  );
  assert.equal(validWasm.modules.length, 2);
  assert.equal(validWasm.defaultModuleKey, "one");
  assert.throws(
    () =>
      parseWasmModuleManifest(
        {
          defaultModuleKey: "one",
          modules: [
            {
              moduleKey: "one",
              sourcePath: "a",
              runtimeDestinations: { client: "x", server: "y" },
            },
            {
              moduleKey: "one",
              sourcePath: "b",
              runtimeDestinations: { client: "x", server: "y" },
            },
          ],
        },
        "wasm-dup",
      ),
    /duplicate module key/,
  );
  assert.throws(
    () =>
      parseWasmModuleManifest(
        {
          defaultModuleKey: "missing",
          modules: [
            {
              moduleKey: "one",
              sourcePath: "a",
              runtimeDestinations: { client: "x", server: "y" },
            },
          ],
        },
        "wasm-default",
      ),
    /default module key/,
  );

  const validTs = parseTsModuleManifest(
    {
      defaultModuleKey: "default",
      modules: [
        {
          moduleKey: "default",
          sourceEntryPath: "src/ts-modules/default.ts",
          runtimeImportPath: "./ts-modules/default",
        },
        {
          moduleKey: "other",
          sourceEntryPath: "src/entry-client.ts",
          runtimeImportPath: "./entry-client",
        },
      ],
    },
    "ts-valid",
  );
  assert.equal(validTs.modules.length, 2);
  assert.equal(validTs.defaultModuleKey, "default");
  assert.throws(
    () =>
      parseTsModuleManifest(
        {
          defaultModuleKey: "default",
          modules: [
            { moduleKey: "default", sourceEntryPath: "a", runtimeImportPath: "./a" },
            { moduleKey: "default", sourceEntryPath: "b", runtimeImportPath: "./b" },
          ],
        },
        "ts-dup",
      ),
    /duplicate module key/,
  );
  assert.throws(
    () =>
      parseTsModuleManifest(
        {
          defaultModuleKey: "missing",
          modules: [{ moduleKey: "default", sourceEntryPath: "a", runtimeImportPath: "./a" }],
        },
        "ts-default",
      ),
    /default module key/,
  );
});

test(
  "webapp templates scaffold wasm and TS manifests with typed loader surfaces",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-multi-module-manifest-contract", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-static demo-static --yes --no-tests`;
      await $`scaf new ts webapp-ssr-vite demo-vite --yes --no-tests`;
      await $`scaf new ts webapp-ssr-next demo-next --yes --no-tests`;

      const apps = [
        {
          root: path.join(tmp, "projects", "apps", "demo-static"),
          wasmManifestRel: path.join("src", "wasm-modules.manifest.json"),
          tsManifestRel: path.join("src", "ts-modules.manifest.json"),
          clientTsLoaderRel: path.join("src", "ts-modules.ts"),
          serverTsLoaderRel: "",
        },
        {
          root: path.join(tmp, "projects", "apps", "demo-vite"),
          wasmManifestRel: path.join("src", "wasm-modules.manifest.json"),
          tsManifestRel: path.join("src", "ts-modules.manifest.json"),
          clientTsLoaderRel: path.join("src", "ts-modules.ts"),
          serverTsLoaderRel: path.join("server", "ts-modules.ts"),
        },
        {
          root: path.join(tmp, "projects", "apps", "demo-next"),
          wasmManifestRel: path.join("app", "wasm-modules.manifest.json"),
          tsManifestRel: path.join("app", "ts-modules.manifest.json"),
          clientTsLoaderRel: path.join("app", "ts-modules.ts"),
          serverTsLoaderRel: path.join("server", "ts-modules.ts"),
        },
      ];

      for (const app of apps) {
        const wasmManifestRaw = await fsp.readFile(
          path.join(app.root, app.wasmManifestRel),
          "utf8",
        );
        const tsManifestRaw = await fsp.readFile(path.join(app.root, app.tsManifestRel), "utf8");
        const wasmManifest = parseWasmModuleManifest(JSON.parse(wasmManifestRaw), app.root);
        const tsManifest = parseTsModuleManifest(JSON.parse(tsManifestRaw), app.root);
        assert.ok(wasmManifest.modules[0]?.runtimeDestinations.client);
        assert.ok(wasmManifest.modules[0]?.runtimeDestinations.server);
        assert.ok(tsManifest.modules.length >= 1);

        const clientTsLoader = await fsp.readFile(
          path.join(app.root, app.clientTsLoaderRel),
          "utf8",
        );
        assert.match(clientTsLoader, /export function listTsModules\(\)/);
        assert.match(clientTsLoader, /export async function loadTsModule\(moduleKey: string\)/);
        if (app.serverTsLoaderRel) {
          const serverTsLoader = await fsp.readFile(
            path.join(app.root, app.serverTsLoaderRel),
            "utf8",
          );
          assert.match(serverTsLoader, /export function listTsModules\(\)/);
          assert.match(serverTsLoader, /export async function loadTsModule\(moduleKey: string\)/);
        }
      }
    });
  },
);

test(
  "webapp-static dev smoke consumes generated manifest loaders in one session",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-multi-module-manifest-smoke", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-static demo-web --yes --no-tests`;

      const appAbs = path.join(tmp, "projects", "apps", "demo-web");

      await _$({ cwd: tmp, stdio: "pipe" })`git add -A projects/apps/demo-web`;
      await _$({
        cwd: tmp,
        stdio: "inherit",
        env: { ...process.env, CI: "1", NEXT_TELEMETRY_DISABLED: "1" },
      })`pnpm install --filter ./projects/apps/demo-web --frozen-lockfile --ignore-scripts --reporter=append-only`;

      const port = await pickFreePort();
      const devServer = spawn(
        "pnpm",
        ["exec", "vite", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
        { cwd: appAbs, stdio: "pipe", env: { ...process.env, NODE_ENV: "development" } },
      );
      try {
        await waitForHttpOk(`http://127.0.0.1:${port}/`);
        const wasmManifest = await httpGet(
          `http://127.0.0.1:${port}/src/wasm-modules.manifest.json`,
        );
        const tsManifest = await httpGet(`http://127.0.0.1:${port}/src/ts-modules.manifest.json`);
        const mainModule = await httpGet(`http://127.0.0.1:${port}/src/main.ts`);
        assert.equal(wasmManifest.status, 200);
        assert.equal(tsManifest.status, 200);
        assert.equal(mainModule.status, 200);
        assert.match(wasmManifest.body, /"defaultModuleKey":\s*"top-contract"/);
        assert.match(tsManifest.body, /"defaultModuleKey":\s*"default-message"/);
        assert.match(mainModule.body, /ts-modules/);
        assert.match(mainModule.body, /wasm-contract/);
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
