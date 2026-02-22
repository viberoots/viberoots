#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { scaffoldBuildAndSmoke } from "../lib/ssr-scaffold-build.ts";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "node SSR express template: scaffold and build via Nix with canonical runnable contract",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const prevRoots = process.env.TEST_RSYNC_ROOTS;
    if (!prevRoots) {
      process.env.TEST_RSYNC_ROOTS =
        "build-tools toolchains third_party/providers prelude patches docs METHODOLOGY.XML AI-PREFERENCES.XML";
    }
    try {
      await runInTemp("node-webapp-ssr-scaffold-build", async (tmp, _$) => {
        await scaffoldBuildAndSmoke(
          tmp,
          "demo-ssr-express",
          "webapp-ssr-express",
          "express",
          'data-ssr-marker="express"',
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
