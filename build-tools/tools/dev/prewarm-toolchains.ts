#!/usr/bin/env zx-wrapper
/**
 * prewarm-toolchains.ts
 *
 * Best-effort prewarm of heavy Nix toolchains to reduce cold-start test latency.
 * - Non-fatal: missing attributes are silently skipped (with a concise note).
 * - Idempotent: guarded by an exclusive lock to avoid redundant concurrent work.
 *
 * Defaults:
 *   PREWARM_ATTRS: comma-separated list of flake attributes to build
 *     toolchains.go,toolchains.cxx,toolchains.emscripten,toolchains.tinygo
 *
 * Test aids:
 *   PREWARM_LIST_ONLY=1 → print JSON list of attributes and exit 0 (no `nix` calls)
 *   PREWARM_VERBOSE=1   → print progress details
 */
import { withExclusiveInstallLock } from "./install/lock.ts";

type BuildResult = { attr: string; ok: boolean; skipped: boolean; output?: string };

function getEnvBool(name: string, def = false): boolean {
  const v = String(process.env[name] || "").trim();
  if (v === "") return def;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

function getAttrList(): string[] {
  const raw = String(process.env.PREWARM_ATTRS || "").trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return ["toolchains.go", "toolchains.cxx", "toolchains.emscripten", "toolchains.tinygo"];
}

async function buildAttr(attr: string, verbose: boolean): Promise<BuildResult> {
  // We intentionally do not use `--dry-run` because some attrs may need to
  // evaluate to detect existence. We rely on nothrow() and classify errors.
  const cmd = $({
    stdio: verbose ? "inherit" : "pipe",
  })`nix build --accept-flake-config --no-link --print-out-paths .#${attr}`.nothrow();
  const res = await cmd;
  const out = String(res.stdout || res.stderr || "").trim();
  if (res.exitCode === 0) {
    return { attr, ok: true, skipped: false, output: out };
  }
  // Missing attr: "does not provide attribute" (Nix error text)
  if (/does not provide attribute/i.test(out) || /attribute .* not found/i.test(out)) {
    if (verbose) {
      console.error(`[prewarm] skip (attr missing): ${attr}`);
    }
    return { attr, ok: true, skipped: true, output: out };
  }
  // Any other error: treat as non-fatal but record output
  if (verbose) {
    console.error(`[prewarm] best-effort build failed: ${attr}\n${out}`);
  }
  return { attr, ok: true, skipped: false, output: out };
}

async function main() {
  const listOnly = getEnvBool("PREWARM_LIST_ONLY", false);
  const verbose = getEnvBool("PREWARM_VERBOSE", false);
  const attrs = getAttrList();

  if (listOnly) {
    console.log(JSON.stringify(attrs));
    return;
  }

  // Single-writer guard to avoid redundant prewarm in parallel processes
  await withExclusiveInstallLock("toolchain-prewarm", async () => {
    for (const a of attrs) {
      try {
        await buildAttr(a, verbose);
      } catch (e: any) {
        // Non-fatal
        if (verbose) {
          console.error(`[prewarm] unexpected error for ${a}:`, e?.message || e);
        }
      }
    }
  });
}

main().catch((e) => {
  // Non-fatal: prewarm is best-effort
  console.error("[prewarm] aborted (best-effort):", e?.message || e);
  process.exit(0);
});
