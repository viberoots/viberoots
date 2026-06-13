#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  DEFAULT_AUTO_MAP_PATH,
  DEFAULT_GRAPH_PATH,
  DEFAULT_INVALIDATION_REPORT_PATH,
  DEFAULT_NIX_ATTR_MAP_PATH,
  DEFAULT_NODE_LOCK_INDEX_PATH,
  providerAutoTargetsPath,
} from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard: prints local dev-override notice and exits 0", async () => {
  await runInTemp("prebuild-dev-overrides", async (tmp, $) => {
    const envWithoutCi = { ...process.env };
    delete envWithoutCi.CI;
    await fsp.mkdir(path.dirname(path.join(tmp, DEFAULT_AUTO_MAP_PATH)), { recursive: true });
    await fsp.mkdir(path.dirname(path.join(tmp, DEFAULT_GRAPH_PATH)), { recursive: true });
    await fsp.writeFile(path.join(tmp, DEFAULT_GRAPH_PATH), "[]", "utf8");
    await fsp.writeFile(path.join(tmp, DEFAULT_NODE_LOCK_INDEX_PATH), "{}\n", "utf8");
    await fsp.writeFile(
      path.join(tmp, DEFAULT_INVALIDATION_REPORT_PATH),
      "# invalidation-report\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, DEFAULT_AUTO_MAP_PATH),
      "# generated\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );
    await fsp.writeFile(path.join(tmp, providerAutoTargetsPath("node")), "# generated\n", "utf8");
    await fsp.writeFile(
      path.join(tmp, DEFAULT_NIX_ATTR_MAP_PATH),
      "# generated\nNIX_ATTR_MAP = {}\n",
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...envWithoutCi,
        NIX_GO_DEV_OVERRIDE_JSON: '{"example.com/mod@v1.2.3":"/tmp/dev"}',
      },
    })`node --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs build-tools/tools/buck/prebuild-guard.ts`.nothrow();

    if (res.exitCode !== 0) {
      throw new Error(`expected exit 0, got ${res.exitCode}\n${res.stderr || ""}`);
    }
    const out = String(res.stderr || "");
    if (
      !out.includes("dev overrides active") ||
      !out.includes("clear with: node build-tools/tools/dev/clear-overrides.ts")
    ) {
      throw new Error(`expected dev-override notice in stderr; got:\n${out}`);
    }
  });
});
