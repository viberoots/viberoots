#!/usr/bin/env zx-wrapper
/**
 * tools/buck/node-cli-bundle.ts
 * Build a single-file Node CLI bundle via Nix and copy it to $OUT.
 *
 * Args:
 *   --importer  Importer directory (e.g., apps/demo)
 *   --name      CLI name (used for output filename when copying)
 *   --out       Destination path (Buck's $OUT)
 */
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli.ts";
import { sanitizeName } from "../lib/sanitize.ts";

// No search/fallbacks: the caller must set FLK_ROOT or WORKSPACE_ROOT to a flake root.

function basenameImporter(s: string): string {
  // apps/demo -> demo, "." -> "."
  const b = path.basename(s);
  return b || s;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

async function main() {
  console.error("[BNX-BUNDLE-DEBUG] node_version=%s argv0=%s", process.version, process.argv0);
  console.error("[BNX-BUNDLE-DEBUG] cwd=%s", process.cwd());
  console.error(
    "[BNX-BUNDLE-DEBUG] env PATH=%s NIX_PATH=%s NIX_PROFILES=%s",
    process.env.PATH || "",
    process.env.NIX_PATH || "",
    process.env.NIX_PROFILES || "",
  );
  const importer = getFlagStr("importer", "").trim();
  const name = getFlagStr("name", "").trim();
  const out = getFlagStr("out", "").trim();
  if (process.argv.includes("--entry")) {
    fail(
      "node-cli-bundle: --entry is not supported. Bundled mode uses a fixed entry (src/index.ts) in the flake.",
    );
  }

  if (!importer) fail("node-cli-bundle: --importer is required (e.g., apps/demo)");
  if (!name) fail("node-cli-bundle: --name is required (e.g., demo)");
  if (!out) fail("node-cli-bundle: --out is required (Buck's $OUT)");

  // Evaluate strictly from WORKSPACE_ROOT so the test's temp workspace is the flake root.
  const repoRoot = (process.env.WORKSPACE_ROOT || "").trim();
  if (!repoRoot) {
    fail("node-cli-bundle: WORKSPACE_ROOT is required for flake evaluation");
  }
  async function run(
    cmd: string,
    argv: string[],
    opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
  ) {
    return await new Promise<string>((resolve, reject) => {
      const p = spawn(cmd, argv, {
        cwd: opts.cwd,
        stdio: ["ignore", "pipe", "inherit"],
        env: opts.env ?? process.env,
      });
      let killed = false;
      const to =
        typeof opts.timeoutMs === "number" && opts.timeoutMs > 0
          ? setTimeout(() => {
              try {
                killed = true;
                p.kill("SIGKILL");
              } catch {}
            }, opts.timeoutMs)
          : undefined;
      let out = "";
      p.stdout.on("data", (d) => (out += d.toString()));
      p.on("error", (e) => {
        if (to) clearTimeout(to);
        reject(e);
      });
      p.on("close", (code) => {
        if (to) clearTimeout(to);
        if (code === 0 && !killed) resolve(out);
        else reject(new Error(`${cmd} exited with code ${code}${killed ? " (killed)" : ""}`));
      });
    });
  }
  // Build via the root flake's per-importer attribute to avoid fragile importer-local flakes.
  // Attribute path is resolved from FLK_ROOT (computed by nix_bootstrap_env) for robustness.
  // Flake root must be the workspace root to avoid store-snapshot misresolutions.
  const flakeRoot = repoRoot;
  try {
    await fsp.access(path.join(flakeRoot, "flake.nix"));
  } catch {
    console.error(
      "[BNX-BUNDLE-DEBUG] flake.nix not found at %s; listing directory for diagnostics:",
      flakeRoot,
    );
    try {
      const entries = await fsp.readdir(flakeRoot, { withFileTypes: true });
      for (const e of entries) {
        console.error(" - %s%s", e.name, e.isDirectory() ? "/" : "");
      }
    } catch {}
    fail(`node-cli-bundle: expected flake.nix at ${path.join(flakeRoot, "flake.nix")}`);
  }
  const workspaceRoot = flakeRoot;
  console.error("[BNX-BUNDLE-DEBUG] importer=%s name=%s out=%s", importer, name, out);
  console.error(
    "[BNX-BUNDLE-DEBUG] repoRoot=%s flakeRoot=%s workspaceRoot=%s",
    repoRoot,
    flakeRoot,
    workspaceRoot,
  );
  const allowGenerate = String(process.env.NIX_PNPM_ALLOW_GENERATE || "") === "1";
  const impureFlags = allowGenerate ? ["--impure"] : [];
  // If generation is allowed, ensure no stale importer lockfile forces a frozen-lockfile path
  if (allowGenerate) {
    try {
      const importerLock = path.join(workspaceRoot, importer, "pnpm-lock.yaml");
      await fsp.unlink(importerLock).catch(() => {});
    } catch {}
  }
  console.error(
    "[BNX-BUNDLE-DEBUG] LOCAL_PNPM_STORE=%s NIX_USE_PREFETCHED_PNPM_STORE=%s",
    String(process.env.LOCAL_PNPM_STORE || ""),
    String(process.env.NIX_USE_PREFETCHED_PNPM_STORE || ""),
  );
  const mj = String(process.env.NIX_MAX_JOBS || "0").trim();
  const cr = String(process.env.NIX_CORES || "0").trim();
  const attr = `node-cli.${sanitizeName(importer)}`;
  console.error("[BNX-BUNDLE-DEBUG] building attr: %s#%s", flakeRoot, attr);
  const nixArgs: string[] = [
    "build",
    `path:${flakeRoot}#${attr}`,
    "--no-link",
    "--accept-flake-config",
    "--no-write-lock-file",
    "--print-out-paths",
    "--builders",
    "",
    "-L",
  ];
  // Only pass --impure when the caller explicitly requested the allow-generate path
  if (allowGenerate) {
    nixArgs.push("--impure");
  }
  if (mj && mj !== "0") {
    nixArgs.push("--max-jobs", mj);
  }
  if (cr && cr !== "0") {
    nixArgs.push("--option", "cores", cr);
  }
  console.error("[BNX-BUNDLE-DEBUG] nix build args: %s", nixArgs.join(" "));
  const heartbeat = setInterval(
    () => console.error("[BNX-BUNDLE-DEBUG] still building via nix..."),
    10000,
  );
  const buildOut = await run("nix", nixArgs, {
    cwd: flakeRoot,
    env: {
      ...process.env,
      WORKSPACE_ROOT: workspaceRoot,
      BUABS: `${path.join(flakeRoot, "tools", "buck", "graph.json")}`,
      BUCK_GRAPH_JSON: `${path.join(flakeRoot, "tools", "buck", "graph.json")}`,
      NIX_PNPM_FETCH_TIMEOUT: String(process.env.NIX_PNPM_FETCH_TIMEOUT || "600"),
    },
    timeoutMs: Math.max(1, Number(process.env.NIX_PNPM_FETCH_TIMEOUT || "600")) * 1000,
  });
  clearInterval(heartbeat);
  const storePath =
    String(buildOut || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop() || "";
  if (!storePath) fail(`node-cli-bundle: nix build produced no out path for importer ${importer}`);

  const expected = path.join(storePath, `${basenameImporter(importer)}.bundle.js`);
  try {
    await fsp.access(expected);
  } catch {
    fail(
      `node-cli-bundle: expected bundle missing: ${expected}\n` +
        `Ensure flake packages.<system>.node-cli.<sanitize(importer)> emits <basename(importer)>.bundle.js`,
    );
  }

  // Copy to Buck's $OUT and make executable
  await fsp.mkdir(path.dirname(out), { recursive: true }).catch(() => {});
  await fsp.copyFile(expected, out);
  try {
    await fsp.chmod(out, 0o755);
  } catch {}
  console.log(`wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
