#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import {
  parseTsModuleManifest,
  parseWasmModuleManifest,
} from "../../scaffolding/webapp-module-manifests";
import { resolveModuleContractsPaths } from "../../dev/module-contract-paths";
import { syncModuleContractsForApp } from "../../dev/sync-module-contracts-core";
import { reconcileTempDependencyInputs, runInTemp } from "../lib/test-helpers";
import { pnpmInstallForDevTest, spawnStaticViteDevServer } from "./lib/dev-node-modules";
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
            server: "server/wasm/top.wasm",
          },
        },
        {
          moduleKey: "two",
          sourcePath: "src/wasm-contract/alt.wasm",
          runtimeDestinations: {
            client: "client/alt.wasm",
            server: "server/wasm/alt.wasm",
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
  "webapp multi-module manifests support generated templates and dev smoke",
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    await runInTemp("webapp-multi-module-manifest-contract", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });

      await t.test(
        "templates generate wasm and TS manifests with typed loader surfaces",
        async () => {
          await $`scaf new ts webapp-static demo-static --yes --no-tests --skip-lockfile-gen`;
          await $`scaf new ts webapp-ssr-vite demo-vite --yes --no-tests --skip-lockfile-gen`;
          await $`scaf new ts webapp-ssr-next demo-next --yes --no-tests --skip-lockfile-gen`;

          const apps = [
            {
              root: path.join(tmp, "projects", "apps", "demo-static"),
              clientTsLoaderRel: path.join("src", "ts-modules.ts"),
              serverTsLoaderRel: "",
              wasmModulesExpected: true,
            },
            {
              root: path.join(tmp, "projects", "apps", "demo-vite"),
              clientTsLoaderRel: path.join("src", "ts-modules.ts"),
              serverTsLoaderRel: path.join("server", "ts-modules.ts"),
              wasmModulesExpected: false,
            },
            {
              root: path.join(tmp, "projects", "apps", "demo-next"),
              clientTsLoaderRel: path.join("app", "ts-modules.ts"),
              serverTsLoaderRel: path.join("server", "ts-modules.ts"),
              wasmModulesExpected: true,
            },
          ];

          for (const app of apps) {
            const contracts = resolveModuleContractsPaths({ appCwd: app.root, root: tmp });
            await syncModuleContractsForApp({
              appCwd: app.root,
              root: tmp,
              appTargetLabel: contracts.appTargetLabel,
            });
            const wasmManifestRaw = await fsp.readFile(contracts.wasmManifestPath, "utf8");
            const tsManifestRaw = await fsp.readFile(contracts.tsManifestPath, "utf8");
            const wasmManifest = parseWasmModuleManifest(JSON.parse(wasmManifestRaw), app.root);
            const tsManifest = parseTsModuleManifest(JSON.parse(tsManifestRaw), app.root);
            assert.equal(
              wasmManifest.modules.length > 0,
              app.wasmModulesExpected,
              `${app.root}: unexpected wasm module count`,
            );
            if (app.wasmModulesExpected) {
              assert.ok(wasmManifest.modules[0]?.runtimeDestinations.client);
              assert.ok(wasmManifest.modules[0]?.runtimeDestinations.server);
            }
            assert.ok(tsManifest.modules.length >= 1);

            const clientTsLoader = await fsp.readFile(
              path.join(app.root, app.clientTsLoaderRel),
              "utf8",
            );
            assert.match(clientTsLoader, /export function listTsModules\(\)/);
            assert.match(
              clientTsLoader,
              /export async function loadTsModule\(\s*moduleKey: string,\s*\)/,
            );
            if (app.serverTsLoaderRel) {
              const serverTsLoader = await fsp.readFile(
                path.join(app.root, app.serverTsLoaderRel),
                "utf8",
              );
              assert.match(serverTsLoader, /export function listTsModules\(\)/);
              assert.match(
                serverTsLoader,
                /export async function loadTsModule\(\s*moduleKey: string,\s*\)/,
              );
            }
          }
        },
      );

      await t.test("webapp-static dev smoke consumes generated manifest loaders", async () => {
        await $`scaf new ts webapp-static demo-web --yes --no-tests --skip-lockfile-gen`;

        const appAbs = path.join(tmp, "projects", "apps", "demo-web");
        const contracts = resolveModuleContractsPaths({ appCwd: appAbs, root: tmp });
        await syncModuleContractsForApp({
          appCwd: appAbs,
          root: tmp,
          appTargetLabel: contracts.appTargetLabel,
        });

        await _$({ cwd: tmp, stdio: "pipe" })`git add -A projects/apps/demo-web`;
        await reconcileTempDependencyInputs(tmp, _$);
        await pnpmInstallForDevTest({
          tmp,
          _$,
          filter: "./projects/apps/demo-web...",
          frozenLockfile: true,
        });

        const port = await pickFreePort();
        const devServer = spawnStaticViteDevServer(appAbs, port);
        try {
          await waitForHttpOk(`http://127.0.0.1:${port}/`);
          const generatedWasmManifest = parseWasmModuleManifest(
            JSON.parse(await fsp.readFile(contracts.wasmManifestPath, "utf8")),
            "webapp-multi-module-manifest-smoke-wasm",
          );
          const generatedTsManifest = parseTsModuleManifest(
            JSON.parse(await fsp.readFile(contracts.tsManifestPath, "utf8")),
            "webapp-multi-module-manifest-smoke-ts",
          );
          const mainModule = await httpGet(`http://127.0.0.1:${port}/src/main.ts`);
          assert.equal(mainModule.status, 200);
          assert.equal(generatedWasmManifest.defaultModuleKey, "top-contract");
          assert.equal(generatedTsManifest.defaultModuleKey, "default-message");
          assert.match(mainModule.body, /ts-modules/);
          assert.match(mainModule.body, /wasm-contract/);
        } finally {
          await stopServer(devServer);
        }
      });
    });
  },
);

after(() => {
  const code = (process as any).exitCode ?? 0;
  setImmediate(() => process.exit(code));
});
