#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { assertSsrAdapterConformance } from "../lib/ssr-adapter-conformance.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  TEST_TIMEOUT_MS,
  buildSelectedSsr,
  scaffoldAndPrepareWorkspace,
  withTempRoots,
} from "./lib/webapp-ssr-pr4.ts";

test(
  "PR-4 SSR next contracts: materialize listing and adapter conformance",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await withTempRoots(async () => {
      await runInTemp("node-webapp-ssr-pr4-next-contracts", async (tmp, _$) => {
        const appName = "demo-ssr-next";
        const label = `//projects/apps/${appName}:app`;
        await scaffoldAndPrepareWorkspace(tmp, _$, "webapp-ssr-next", appName);
        const { outPath, importer } = await buildSelectedSsr(tmp, _$, label, "next");
        await assertSsrAdapterConformance({ label, outPath, importer, framework: "next" });
      });
    });
  },
);
