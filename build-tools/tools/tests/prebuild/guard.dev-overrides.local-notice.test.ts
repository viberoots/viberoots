#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard: prints local dev-override notice and exits 0", async () => {
  await runInTemp("prebuild-dev-overrides", async (tmp, $) => {
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "build-tools", "tools", "buck"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "build-tools", "tools", "buck", "graph.json"), "[]", "utf8");
    await fsp.writeFile(
      path.join(tmp, "build-tools", "tools", "buck", "node-lock-index.json"),
      "{}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "build-tools", "tools", "buck", "invalidation-report.txt"),
      "# invalidation-report\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "auto_map.bzl"),
      "# generated\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "TARGETS.auto"),
      "# generated\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "nix_attr_map.bzl"),
      "# generated\nNIX_ATTR_MAP = {}\n",
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        CI: "", // ensure local mode
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
