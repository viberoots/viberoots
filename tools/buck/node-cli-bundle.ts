#!/usr/bin/env zx-wrapper
/**
 * tools/buck/node-cli-bundle.ts
 * Build a single-file Node CLI bundle via Nix and copy it to $OUT.
 *
 * Args:
 *   --importer  Importer directory (e.g., apps/demo)
 *   --name      CLI name (used for output filename when copying)
 *   --out       Destination path (Buck's $OUT)
 *   --entry     Optional entry file (unused by the flake today; accepted for future)
 */
import path from "node:path";
import * as fsp from "node:fs/promises";
import { spawn } from "node:child_process";
import { getFlagStr } from "../lib/cli.ts";

function sanitizeImporterAttr(s: string): string {
  // Keep in sync with tools/nix/templates-common.nix sanitizeName
  return s.replaceAll("//", "").replaceAll(":", "-").replaceAll("/", "-").replaceAll(" ", "-");
}

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
  const importer = getFlagStr("importer", "").trim();
  const name = getFlagStr("name", "").trim();
  const out = getFlagStr("out", "").trim();
  // entry accepted for forward compatibility; unused in current flake pipeline
  // const entry = getFlagStr("entry", "").trim();

  if (!importer) fail("node-cli-bundle: --importer is required (e.g., apps/demo)");
  if (!name) fail("node-cli-bundle: --name is required (e.g., demo)");
  if (!out) fail("node-cli-bundle: --out is required (Buck's $OUT)");

  // Prefer evaluating from the temp repo root so importer-local flake is visible.
  const repoRoot = process.env.WORKSPACE_ROOT?.trim() || process.cwd();
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
  // Build importer-local flake (apps/<name>/flake.nix) to avoid repo-wide eval churn.
  const importerAbs = path.join(repoRoot, importer);
  const mj = String(process.env.NIX_MAX_JOBS || "0").trim();
  const cr = String(process.env.NIX_CORES || "0").trim();
  const nixArgs: string[] = [
    "build",
    `path:${importerAbs}#node-cli`,
    "--no-link",
    "--accept-flake-config",
    "--impure",
    "--no-write-lock-file",
    "--print-out-paths",
    "--builders",
    "",
  ];
  if (mj && mj !== "0") {
    nixArgs.push("--max-jobs", mj);
  }
  if (cr && cr !== "0") {
    nixArgs.push("--option", "cores", cr);
  }
  const stdout = await run("nix", nixArgs, {
    cwd: repoRoot,
    env: {
      ...process.env,
      WORKSPACE_ROOT: repoRoot,
      REPO_ROOT: repoRoot,
    },
    // Bound the bundle build to avoid deadlocks; allow override via env if needed
    timeoutMs: Math.max(1, Number(process.env.NIX_PNPM_FETCH_TIMEOUT || "600")) * 1000,
  });
  // Mitigate rare transient ENOENT during flake source import by retrying once.
  let buildOut = stdout;
  if (!String(buildOut || "").trim()) {
    try {
      // Small backoff before retry
      await new Promise((r) => setTimeout(r, 300));
      buildOut = await run("nix", nixArgs, {
        cwd: repoRoot,
        env: {
          ...process.env,
          WORKSPACE_ROOT: repoRoot,
          REPO_ROOT: repoRoot,
        },
        timeoutMs: Math.max(1, Number(process.env.NIX_PNPM_FETCH_TIMEOUT || "600")) * 1000,
      });
    } catch (e) {
      // Re-throw with clear context
      fail(
        `node-cli-bundle: nix build failed twice for importer ${importer}: ${(e as Error).message || e}`,
      );
    }
  }
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
