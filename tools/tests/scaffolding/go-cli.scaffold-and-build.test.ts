#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go cli: scaffold and build", async () => {
  await runInTemp("go-cli-scaffold-and-build", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`scaf new go cli demo-cli --yes --path=apps/demo-cli`;
    // Ensure CLI module has a tidy go.sum for gomod2nix
    await $({ cwd: path.join(_tmp, "apps", "demo-cli"), stdio: "inherit" })`go mod tidy`;
    // Generate gomod2nix from CLI module and copy lockfile to repo root (authoritative)
    await $({ cwd: _tmp, stdio: "inherit" })`tools/bin/gomod2nix --dir apps/demo-cli`;
    await fsp.copyFile(
      path.join(_tmp, "apps", "demo-cli", "gomod2nix.toml"),
      path.join(_tmp, "gomod2nix.toml"),
    );
    // Generate glue and build via Nix graph-generator on the temp repo
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
    // Verify manifest contains the CLI bin entry
    const manifestPath = path.join(_tmp, outLinkName, "manifest.json");
    const txt = await fsp.readFile(manifestPath, "utf8");
    const entries = JSON.parse(txt) as Array<any>;
    const entry = entries.find(
      (e) =>
        e && e.label === "//apps/demo-cli:demo-cli" && Array.isArray(e.bins) && e.bins.length > 0,
    );
    if (!entry) throw new Error("expected CLI bin in manifest for //apps/demo-cli:demo-cli");
  });
});
