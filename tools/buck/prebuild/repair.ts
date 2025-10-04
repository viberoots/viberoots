#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";

async function ensureLocalPreludeMapping() {
  try {
    const cfgPath = path.join(process.cwd(), ".buckconfig");
    let ok = false;
    try {
      const txt = await fs.readFile(cfgPath, "utf8");
      const hasRepo = /\[repositories\][\s\S]*?^\s*prelude\s*=\s*/m.test(txt);
      const hasCells = /\[cells\][\s\S]*?^\s*prelude\s*=\s*/m.test(txt);
      ok = hasRepo && hasCells;
    } catch {}
    if (ok) return;

    const cfgTxt = [
      "[buildfile]",
      "name = TARGETS",
      "",
      "[repositories]",
      "root = .",
      "prelude = ./prelude",
      "toolchains = ./toolchains",
      "repo_toolchains = ./toolchains",
      "fbsource = ./prelude/third-party/fbsource_stub",
      "fbcode = ./prelude/third-party/fbcode_stub",
      "config = ./prelude",
      "",
      "[cells]",
      "root = .",
      "prelude = ./prelude",
      "toolchains = ./toolchains",
      "repo_toolchains = ./toolchains",
      "fbsource = ./prelude/third-party/fbsource_stub",
      "fbcode = ./prelude/third-party/fbcode_stub",
      "config = ./prelude",
      "",
      "[build]",
      "prelude = prelude",
      "user_platform = prelude//platforms:default",
      "target_platforms = prelude//platforms:default",
      "",
    ].join("\n");

    const preludeLocal = fs.existsSync(path.join(process.cwd(), "prelude"));
    if (preludeLocal) {
      try {
        await fs.writeFile(path.join(process.cwd(), ".buckroot"), "");
      } catch {}
      await fs.outputFile(cfgPath, cfgTxt, "utf8");
      return;
    }

    let out = "";
    try {
      const { stdout } =
        await $`nix build .#buck2-prelude --no-link --accept-flake-config --print-out-paths`;
      out =
        String(stdout || "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .pop() || "";
    } catch {}
    if (!out) {
      try {
        const { stdout } = await $`nix eval --raw .#inputs.buck2.outPath`;
        out = String(stdout || "").trim();
      } catch {}
    }
    if (!out) return;
    const preludeDir = path.join(out, "prelude");
    try {
      await fs.writeFile(path.join(process.cwd(), ".buckroot"), "");
    } catch {}
    try {
      await fs.remove("prelude");
    } catch {}
    try {
      await fs.symlink(preludeDir, "prelude");
    } catch {}
    await fs.outputFile(cfgPath, cfgTxt, "utf8");
  } catch {}
}

export async function autoFixGlue() {
  // Ensure gomod2nix.toml is generated before glue; ignore errors in local mode
  try {
    await $`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/dev/install-deps.ts --glue-only`;
  } catch {}
  const nodeBase = ["--experimental-strip-types", "--import", "./tools/dev/zx-init.mjs"];
  await $`node ${nodeBase} tools/buck/export-graph.ts --out tools/buck/graph.json`;
  await $`node ${nodeBase} tools/buck/sync-providers.ts`;
  // Capability-gated: run Node provider sync only if a pnpm-lock.yaml exists
  try {
    const { stdout } = await $`git ls-files '**/pnpm-lock.yaml'`;
    if (String(stdout || "").trim().length > 0) {
      await $`node ${nodeBase} tools/buck/sync-providers-node.ts`;
    }
  } catch {}
  await $`node ${nodeBase} tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
}
