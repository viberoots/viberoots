#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { assertSsrAdapterConformance } from "../lib/ssr-adapter-conformance.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  TEST_TIMEOUT_MS,
  buildSelectedSsr,
  runExpressDockerSmoke,
  scaffoldAndPrepareWorkspace,
  withTempRoots,
} from "./lib/webapp-ssr.ts";

test(
  "SSR express contracts: materialize listing, adapter conformance, and Docker startup shape",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await withTempRoots(async () => {
      await runInTemp("node-webapp-ssr-express-contracts", async (tmp, _$) => {
        const appName = "demo-ssr-express";
        const label = `//projects/apps/${appName}:app`;
        await scaffoldAndPrepareWorkspace(tmp, _$, "webapp-ssr-express", appName);
        const { outPath, importer } = await buildSelectedSsr(tmp, _$, label, "express");
        await assertSsrAdapterConformance({ label, outPath, importer, framework: "express" });

        const appAbs = path.join(tmp, importer);
        await _$({
          cwd: appAbs,
          stdio: "inherit",
          env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
        })`pnpm install --prod --frozen-lockfile --ignore-scripts --ignore-workspace --reporter=append-only`;

        const runtimeRoot = path.join(tmp, "docker-runtime-express");
        await fsp.mkdir(runtimeRoot, { recursive: true });
        await fsp.cp(path.join(outPath, "dist"), path.join(runtimeRoot, "dist"), {
          recursive: true,
        });
        await fsp.symlink(
          path.join(appAbs, "node_modules"),
          path.join(runtimeRoot, "node_modules"),
        );
        await runExpressDockerSmoke(runtimeRoot, 'data-ssr-marker="express"');
      });
    });
  },
);
