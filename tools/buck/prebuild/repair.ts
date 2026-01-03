#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runGlue } from "../glue-run.ts";
import { runNodeWithZx } from "../../lib/node-run.ts";

async function ensureLocalPreludeMapping() {
  try {
    const cfgPath = path.join(process.cwd(), ".buckconfig");
    let ok = false;
    try {
      const txt = await fsp.readFile(cfgPath, "utf8");
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
      "default_platform = prelude//platforms:default",
      "user_platform = prelude//platforms:default",
      "target_platforms = prelude//platforms:default",
      "",
    ].join("\n");

    const preludeLocal = fs.existsSync(path.join(process.cwd(), "prelude"));
    if (preludeLocal) {
      try {
        await fsp.writeFile(path.join(process.cwd(), ".buckroot"), ".\n");
      } catch {}
      await fsp.writeFile(cfgPath, cfgTxt, "utf8");
      return;
    }

    let out = "";
    const flakeRef = `path:${process.cwd()}`;
    try {
      const { stdout } =
        await $`nix build ${flakeRef}#buck2-prelude --no-link --accept-flake-config --print-out-paths --option warn-dirty false`;
      out =
        String(stdout || "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .pop() || "";
    } catch {}
    if (!out) {
      try {
        const { stdout } =
          await $`nix eval --raw ${flakeRef}#inputs.buck2.outPath --option warn-dirty false`;
        out = String(stdout || "").trim();
      } catch {}
    }
    if (!out) return;
    const preludeDir = path.join(out, "prelude");
    try {
      await fsp.writeFile(path.join(process.cwd(), ".buckroot"), ".\n");
    } catch {}
    try {
      await fsp.rm("prelude", { recursive: true, force: true });
    } catch {}
    try {
      await fsp.symlink(preludeDir, "prelude");
    } catch {}
    await fsp.writeFile(cfgPath, cfgTxt, "utf8");
  } catch {}
}

async function removeInvalidGraphJsonIfPresent() {
  const graphPath = path.join(process.cwd(), "tools", "buck", "graph.json");
  try {
    const txt = await fsp.readFile(graphPath, "utf8");
    try {
      JSON.parse(txt);
      return;
    } catch {
      await fsp.rm(graphPath, { force: true });
    }
  } catch {}
}

export async function autoFixGlue() {
  // Ensure local .buckconfig/.buckroot and prelude mapping exist so Buck commands use a valid platform
  await ensureLocalPreludeMapping();
  // If a previous step created a non-JSON graph (e.g. temp tests touching with a comment),
  // delete it so ensureGraph regenerates deterministically.
  await removeInvalidGraphJsonIfPresent();
  // Ensure gomod2nix.toml is generated before glue; ignore errors in local mode
  try {
    await runNodeWithZx({
      zxInitPath: path.resolve("tools/dev/zx-init.mjs"),
      script: path.resolve("tools/dev/install-deps.ts"),
      args: ["--glue-only"],
    });
  } catch {}
  // Run unified glue orchestration (export graph → provider index → auto-map)
  await runGlue();
}
