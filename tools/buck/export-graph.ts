#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { run } from "./exporter/main.ts";

// Preserve existing best-effort prelude setup to avoid behavior change (moved out in PR 2)
async function ensurePreludeBuckConfig() {
  try {
    const cfg = path.join(process.cwd(), ".buckconfig");
    const has = await fs.pathExists(cfg);
    if (has) {
      const txt = await fs.readFile(cfg, "utf8").catch(() => "");
      if (/^\[build\][\s\S]*?^prelude\s*=\s*prelude/m.test(txt)) return;
    }
    let out = "";
    try {
      const { stdout } = await $({
        stdio: "pipe",
      })`nix build .#buck2-prelude --no-link --accept-flake-config --print-out-paths`;
      out =
        String(stdout || "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .pop() || "";
    } catch {}
    if (!out) {
      try {
        const { stdout } = await $({ stdio: "pipe" })`nix eval --raw .#inputs.buck2.outPath`;
        out = String(stdout || "").trim();
      } catch {}
    }
    if (!out) return;
    const preludeDir = path.join(out, "prelude");
    await fs.writeFile(path.join(process.cwd(), ".buckroot"), "");
    await fs.remove("prelude").catch(() => {});
    await fs.symlink(preludeDir, "prelude").catch(async () => {
      try {
        const cur = await fs.readlink("prelude");
        if (path.resolve(cur) !== path.resolve(preludeDir)) {
          await fs.unlink("prelude");
          await fs.symlink(preludeDir, "prelude");
        }
      } catch {}
    });
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
      "",
    ].join("\n");
    await fs.writeFile(cfg, cfgTxt, "utf8");
  } catch {}
}

async function main() {
  await ensurePreludeBuckConfig();
  await run();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
