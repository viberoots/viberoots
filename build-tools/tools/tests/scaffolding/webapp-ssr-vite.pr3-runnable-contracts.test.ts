#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { inferRunnableFromOutPath } from "../../lib/runnables.ts";
import { assertSsrAdapterConformance } from "../lib/ssr-adapter-conformance.ts";
import { runInTemp } from "../lib/test-helpers";
import {
  TEST_TIMEOUT_MS,
  buildSelectedSsr,
  runExpressDockerSmoke,
  scaffoldAndPrepareWorkspace,
  withTempRoots,
} from "./lib/webapp-ssr-pr4.ts";

async function expectMissingArtifactFailure(
  scratchRoot: string,
  importer: string,
  label: string,
  missing: "serverEntry" | "clientDir",
): Promise<void> {
  const sandbox = path.join(scratchRoot, `vite-pr4-missing-${missing}`);
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(path.join(sandbox, "dist", "server"), { recursive: true });
  if (missing === "clientDir") {
    await fsp.writeFile(path.join(sandbox, "dist", "server", "index.js"), "export {};\n", "utf8");
  } else {
    await fsp.mkdir(path.join(sandbox, "dist", "client"), { recursive: true });
  }

  await assert.rejects(
    async () =>
      inferRunnableFromOutPath({
        label,
        outPath: sandbox,
        importer,
        mode: "ssr",
        framework: "vite",
      }),
    new RegExp(`missing ${missing}`),
  );
}

test(
  "PR-4 Vite SSR contracts: packaging shape, runtime startup, and missing-artifact failures",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await withTempRoots(async () => {
      await runInTemp("node-webapp-ssr-vite-pr4-contracts", async (tmp, _$) => {
        const appName = "demo-ssr-vite";
        const label = `//projects/apps/${appName}:app`;
        await scaffoldAndPrepareWorkspace(tmp, _$, "webapp-ssr-vite", appName);
        const { outPath, importer } = await buildSelectedSsr(tmp, _$, label, "vite");
        await assertSsrAdapterConformance({ label, outPath, importer, framework: "vite" });

        const appAbs = path.join(tmp, importer);
        await _$({
          cwd: appAbs,
          stdio: "inherit",
          env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
        })`pnpm install --prod --frozen-lockfile --ignore-scripts --ignore-workspace --reporter=append-only`;

        const runtimeRoot = path.join(tmp, "docker-runtime-vite");
        await fsp.rm(runtimeRoot, { recursive: true, force: true });
        await fsp.mkdir(runtimeRoot, { recursive: true });
        await fsp.cp(path.join(outPath, "dist"), path.join(runtimeRoot, "dist"), {
          recursive: true,
        });
        await fsp.symlink(
          path.join(appAbs, "node_modules"),
          path.join(runtimeRoot, "node_modules"),
        );
        await runExpressDockerSmoke(runtimeRoot, 'data-ssr-marker="vite"');

        await expectMissingArtifactFailure(tmp, importer, label, "serverEntry");
        await expectMissingArtifactFailure(tmp, importer, label, "clientDir");
      });
    });
  },
);
