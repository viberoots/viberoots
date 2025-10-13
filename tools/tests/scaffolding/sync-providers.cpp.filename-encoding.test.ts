#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { providerNameForNixAttr } from "../../lib/providers";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("cpp-encoding", async (tmp, $) => {
  await fs.mkdirp(path.join(tmp, "patches/cpp"));
  // pkgs.openssl -> pkgs__openssl prefix
  await fs.outputFile(path.join(tmp, "patches/cpp/pkgs__openssl@3.0.0.patch"), "--- a\n+++ b\n");

  // Minimal graph and curated providers (optional)
  await fs.mkdirp(path.join(tmp, "tools/buck"));
  await fs.outputFile(path.join(tmp, "tools/buck/graph.json"), "[]", "utf8");

  // Run sync; expect provider name derived from nix attr
  await $({ cwd: tmp })`tools/buck/sync-providers.ts --lang cpp`;
  const out = await fs.readFile(path.join(tmp, "third_party/providers/TARGETS.cpp.auto"), "utf8");
  const name = providerNameForNixAttr("pkgs.openssl");
  if (!out.includes(`name = "${name}"`)) {
    console.error("expected provider for pkgs.openssl in output\n", out);
    process.exit(2);
  }
});
