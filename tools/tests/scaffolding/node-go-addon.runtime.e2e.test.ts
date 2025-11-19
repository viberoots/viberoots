#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// Ensure dev env tooling when invoking Buck/Nix inside temp repos
process.env.TEST_NEED_DEV_ENV = "1";

test("node go-addon: scaffold, build addon via Buck planner, run and observe Go->Node data", async () => {
  await runInTemp("node-go-addon-runtime-e2e", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });

    // Scaffold the three sibling packages (Node TS, Go c-archive, C N-API binding)
    await $`git init`;
    await $`scaf new node go-addon demo --yes`;

    // Export Buck graph for the temp repo (exercise exporter path; not strictly required to build)
    await $({
      env: { ...process.env, BUCK_QUERY_ROOTS: "libs,go,cpp,third_party" },
    })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs ./tools/buck/export-graph.ts --out tools/buck/graph.json`;

    // Build via Buck2 to exercise macro -> planner -> Nix through the normal user path
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build //libs/demo-native:napi_addon --show-full-output --target-platforms //:no_cgo`;
    if (res.exitCode !== 0) {
      console.error(String(res.stdout || "") + "\n" + String(res.stderr || ""));
      throw new Error("buck2 build failed for //libs/demo-native:napi_addon");
    }
    const line =
      String(res.stdout || "")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .pop() || "";
    const parts = line.split(/\s+/);
    const producedAddon = parts[parts.length - 1];
    if (!producedAddon || !producedAddon.endsWith(".node")) {
      throw new Error("could not locate built addon path from buck2 output");
    }

    // Materialize the addon at the stable runtime path expected by the loader
    const addonName = "demo_addon";
    const stableAddon = path.join(tmp, "libs", "demo", "native", `${addonName}.node`);
    await fsp.mkdir(path.dirname(stableAddon), { recursive: true });
    await fsp.copyFile(producedAddon, stableAddon);

    // Run a tiny Node script that requires the addon and verifies data came from Go
    const runner = path.join(tmp, "run-e2e.cjs");
    const script = `
      const path = require("node:path");
      const addon = require(path.resolve("libs/demo/native/${addonName}.node"));
      const sum = addon.add(2, 3);
      if (sum !== 5) {
        console.error("[e2e] unexpected sum", sum);
        process.exit(2);
      }
      console.log("[e2e] sum", sum);
    `;
    await fsp.writeFile(runner, script, "utf8");
    const exec = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`node run-e2e.cjs`;
    if (exec.exitCode !== 0) {
      console.error(String(exec.stdout || "") + "\n" + String(exec.stderr || ""));
      throw new Error("e2e runtime script failed");
    }
    const out = String(exec.stdout || "");
    if (!out.includes("[e2e] sum 5")) {
      throw new Error("expected runtime output '[e2e] sum 5' not found");
    }
  });
});
