#!/usr/bin/env zx-wrapper
import "zx/globals";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

void (async function main() {
  console.log("TAP version 13");
  const ok = await runInTemp("planner-bins-only", async (tmp, $) => {
    // Scaffold a lib and a cli so we have both kinds in graph
    await $`scaf new go lib demo-lib --yes --path=libs/demo-lib`;
    await $`scaf new go cli demo-cli --yes --path=apps/demo-cli`;

    // Seed gomod2nix from the CLI module to ensure dependencies exist
    await $({ cwd: path.join(tmp, "apps", "demo-cli") })`go mod tidy`;
    await $({ cwd: tmp })`tools/bin/gomod2nix --dir apps/demo-cli`;
    await fsp.copyFile(
      path.join(tmp, "apps", "demo-cli", "gomod2nix.toml"),
      path.join(tmp, "gomod2nix.toml"),
    );

    // Glue and build via Nix
    await $`tools/dev/install-deps.ts --glue-only`;
    const outLink = `buck-go-${Date.now()}`;
    await $({ cwd: tmp })`nix build .#graph-generator --out-link ${outLink}`;

    const manifestPath = path.join(tmp, outLink, "manifest.json");
    const txt = await fsp.readFile(manifestPath, "utf8");
    const arr = JSON.parse(txt) as Array<any>;
    // Assert only binaries are present (label ends with demo-cli target, not lib)
    const labels = arr.map((e) => String(e?.label || ""));
    const hasCli = labels.some((l) => /apps\/demo-cli:demo-cli/.test(l));
    const hasLib = labels.some((l) => /libs\/demo-lib:demo-lib/.test(l));
    if (!hasCli || hasLib) {
      console.log("not ok 1 - manifest should contain only binaries (cli present, lib absent)");
      console.log(`  ---\n  labels: ${JSON.stringify(labels)}\n  ...`);
      return false;
    }
    console.log("ok 1 - manifest contains only binaries (library excluded)");
    return true;
  });
  console.log("1..1");
  if (!ok) process.exit(1);
})();
