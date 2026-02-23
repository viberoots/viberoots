#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { scaffoldBuildAndSmoke } from "../lib/ssr-scaffold-build.ts";
import { runInTemp } from "../lib/test-helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "PR-3 Vite SSR contracts: planner/runnable metadata keeps canonical SSR startup",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const prevRoots = process.env.TEST_RSYNC_ROOTS;
    if (!prevRoots) {
      process.env.TEST_RSYNC_ROOTS =
        "build-tools toolchains third_party/providers prelude patches docs METHODOLOGY.XML AI-PREFERENCES.XML";
    }
    try {
      await runInTemp("node-webapp-ssr-vite-pr3-contracts", async (tmp, _$) => {
        await scaffoldBuildAndSmoke(
          tmp,
          "demo-ssr-vite-pr3",
          "webapp-ssr-vite",
          "vite",
          'data-ssr-marker="vite"',
          false,
          _$,
        );
      });
    } finally {
      if (prevRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
      else process.env.TEST_RSYNC_ROOTS = prevRoots;
    }
  },
);
