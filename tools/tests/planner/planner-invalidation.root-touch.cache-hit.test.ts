#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// PR1 invalidation test: touching a non-app/lib file at repo root should NOT
// change the app binary derivation (cache hit expected; store path unchanged).

test("planner: touching root-only file does not change app bin store path", async () => {
  await runInTemp("planner-invalidation-root-touch", async (tmp, $) => {
    // Scaffold a small CLI app under apps/
    await $`scaf new go cli demo-cli --yes --path=apps/demo-cli`;
    // Ensure module has minimal deps metadata and lock
    await $({ cwd: path.join(tmp, "apps", "demo-cli"), stdio: "inherit" })`go mod tidy`;
    await $({ cwd: tmp, stdio: "inherit" })`tools/bin/gomod2nix --dir apps/demo-cli`;
    // Copy per-app gomod2nix.toml to repo root so planner can find a default
    await fsp.copyFile(
      path.join(tmp, "apps", "demo-cli", "gomod2nix.toml"),
      path.join(tmp, "gomod2nix.toml"),
    );

    // Generate glue, then build graph-generator bundle
    await $`tools/dev/install-deps.ts --glue-only`;
    const outLink1 = `buck-go-${Date.now()}`;
    await $({ cwd: tmp, stdio: "inherit" })`nix build .#graph-generator --out-link ${outLink1}`;

    // Read manifest and ensure demo-cli entry exists with at least one bin
    const manifest1Path = path.join(tmp, outLink1, "manifest.json");
    const manifest1Txt = await fsp.readFile(manifest1Path, "utf8");
    const manifest1 = JSON.parse(manifest1Txt) as Array<any>;
    const entry1 = manifest1.find((e) => String(e?.label || "").includes("apps/demo-cli:demo-cli"));
    if (!entry1 || !Array.isArray(entry1?.bins) || entry1.bins.length === 0) {
      throw new Error("missing demo-cli bin in manifest after first build");
    }
    const normalized1 = manifest1Txt.replace(/\/nix\/store\/[a-z0-9]{32,}-[^\"]+/g, "/nix/store/STOREHASH-BIN");

    // Touch a root-only file that should be excluded by filtered src
    const sentinel = path.join(tmp, "ROOT_ONLY_SENTINEL.txt");
    await fsp.writeFile(sentinel, "root-only-change\n", "utf8");

    // Rebuild and compare the demo-cli bin store path
    const outLink2 = `buck-go-${Date.now()}`;
    await $({ cwd: tmp, stdio: "inherit" })`nix build .#graph-generator --out-link ${outLink2}`;
    const manifest2Path = path.join(tmp, outLink2, "manifest.json");
    const manifest2Txt = await fsp.readFile(manifest2Path, "utf8");
    const manifest2 = JSON.parse(manifest2Txt) as Array<any>;
    const entry2 = manifest2.find((e) => String(e?.label || "").includes("apps/demo-cli:demo-cli"));
    if (!entry2 || !Array.isArray(entry2?.bins) || entry2.bins.length === 0) {
      throw new Error("missing demo-cli bin in manifest after second build");
    }
    const normalized2 = manifest2Txt.replace(/\/nix\/store\/[a-z0-9]{32,}-[^\"]+/g, "/nix/store/STOREHASH-BIN");

    if (normalized1 !== normalized2) {
      console.error("expected normalized manifest to remain unchanged after touching root-only file");
      console.error("manifest before (normalized):", normalized1);
      console.error("manifest after  (normalized):", normalized2);
      process.exit(2);
    }
  });
});
