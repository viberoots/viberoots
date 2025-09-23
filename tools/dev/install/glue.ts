#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

export function zxNodeBase(): string {
  const zxInit = path.resolve("tools/dev/zx-init.mjs");
  return [
    "--experimental-top-level-await",
    "--experimental-strip-types",
    "--disable-warning=ExperimentalWarning",
    "--import",
    zxInit,
  ].join(" ");
}

async function ensurePreludeIfMissing() {
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
    const preludeLocal = path.join(process.cwd(), "prelude");
    try {
      const fs = await import("fs-extra");
      if (await fs.pathExists(preludeLocal)) {
        const cfg = [
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
        try {
          await fsp.writeFile(path.join(process.cwd(), ".buckroot"), "");
        } catch {}
        await fsp.mkdir(path.dirname(cfgPath), { recursive: true }).catch(() => {});
        await fsp.writeFile(cfgPath, cfg, "utf8");
        return;
      }
    } catch {}
    let out = "";
    try {
      const res = await $({
        stdio: "pipe",
      })`nix build .#buck2-prelude --no-link --accept-flake-config --print-out-paths`;
      out =
        String(res.stdout || "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .pop() || "";
    } catch {}
    if (!out) {
      try {
        const ev = await $({ stdio: "pipe" })`nix eval --raw .#inputs.buck2.outPath`;
        out = String(ev.stdout || "").trim();
      } catch {}
    }
    if (!out) return;
    const preludeDir = path.join(out, "prelude");
    try {
      await fsp.writeFile(path.join(process.cwd(), ".buckroot"), "");
    } catch {}
    try {
      await fsp.rm("prelude", { recursive: true, force: true });
    } catch {}
    try {
      await fsp.symlink(preludeDir, "prelude");
    } catch {}
    const cfg = [
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
    try {
      await fsp.writeFile(cfgPath, cfg, "utf8");
    } catch {}
  } catch {}
}

export async function runGlue(dryRun: boolean, verbose: boolean) {
  const nodeBase = zxNodeBase();
  const nodeBin = process.execPath || "node";
  const cmds: Array<{ label: string; cmd: string }> = [
    {
      label: "export-graph",
      cmd: `${nodeBin} ${nodeBase} tools/buck/export-graph.ts --out tools/buck/graph.json`,
    },
    { label: "sync-providers-go", cmd: `${nodeBin} ${nodeBase} tools/buck/sync-providers.ts` },
    {
      label: "sync-providers-node",
      cmd: `${nodeBin} ${nodeBase} tools/buck/sync-providers-node.ts`,
    },
    {
      label: "gen-auto-map",
      cmd: `${nodeBin} ${nodeBase} tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`,
    },
  ];
  await ensurePreludeIfMissing();
  for (const c of cmds) {
    if (dryRun) {
      console.log(`[dry-run] ${c.cmd}`);
      continue;
    }
    if (verbose) console.log(`[run] ${c.cmd}`);
    await $({ stdio: "inherit" })`bash --noprofile --norc -c ${c.cmd}`;
  }
}
