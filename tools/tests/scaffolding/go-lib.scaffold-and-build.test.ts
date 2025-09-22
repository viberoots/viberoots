#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go lib: scaffold and build+test", async () => {
  await runInTemp("go-lib-scaffold-and-build", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`scaf new go lib demo-lib --yes --path=libs/demo-lib`;
    // Initialize and tidy module to ensure gomod2nix can lock
    await $({ cwd: path.join(_tmp, "libs", "demo-lib"), stdio: "inherit" })`go mod tidy`;
    // Generate gomod2nix from lib module and copy lockfile to repo root
    await $({ cwd: _tmp, stdio: "inherit" })`tools/bin/gomod2nix --dir libs/demo-lib`;
    await fsp.copyFile(
      path.join(_tmp, "libs", "demo-lib", "gomod2nix.toml"),
      path.join(_tmp, "gomod2nix.toml"),
    );
    // Build via Nix graph-generator on the temp repo (libs produce no bin; just ensure manifest exists)
    await $`tools/dev/install-deps.ts --glue-only`;
    const outLinkName = `buck-go-${Date.now()}`;
    const outLinkPath = path.join(_tmp, outLinkName);
    try {
      await fsp.rm(outLinkPath, { recursive: false, force: true });
    } catch {}
    await $({
      cwd: _tmp,
      stdio: "inherit",
      env: { WORKSPACE_ROOT: _tmp },
    })`nix build .#graph-generator --out-link ${outLinkName} --impure`;
    const manifestPath = path.join(_tmp, outLinkName, "manifest.json");
    await fsp.access(manifestPath);
  });
});
