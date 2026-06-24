#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "webapp raw pnpm fetch compatibility stays isolated from runtime smoke",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-raw-pnpm-install-compat", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-static demo-web --yes --no-tests --skip-store-hash-refresh`;

      const rawPnpm = _$({
        cwd: tmp,
        stdio: "inherit",
        env: {
          ...process.env,
          CI: "1",
          NODE_OPTIONS: "--no-warnings",
          NEXT_TELEMETRY_DISABLED: "1",
        },
      });

      await rawPnpm`pnpm --dir ${tmp} fetch --filter ./projects/apps/demo-web... --prod=false --frozen-lockfile --prefer-offline --ignore-scripts --ignore-pnpmfile --reporter=append-only --color=never --network-concurrency 1 --child-concurrency 1`;

      const appAbs = path.join(tmp, "projects", "apps", "demo-web");
      assert.equal(await exists(path.join(appAbs, "dist")), false);
      const pkg = JSON.parse(await fsp.readFile(path.join(appAbs, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      };
      assert.equal(pkg.scripts?.build, "node scripts/build.mjs");
      assert.equal(pkg.scripts?.dev, "node scripts/dev.mjs");
    });
  },
);

after(() => {
  const code = (process as any).exitCode ?? 0;
  setImmediate(() => process.exit(code));
});
