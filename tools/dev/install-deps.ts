#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

console.log("Installing dependencies...");
type Flags = { force: boolean; dryRun: boolean; verbose: boolean; skipGlue: boolean };
function parseFlags(argv: string[]): Flags {
  let force = false;
  let dryRun = process.env.INSTALL_DEPS_DRY_RUN === "1";
  let verbose = false;
  let skipGlue = false;
  for (const a of argv) {
    if (a === "--force") force = true;
    if (a === "--dry-run") dryRun = true;
    if (a === "--verbose" || a === "-v") verbose = true;
    if (a === "--skip-glue") skipGlue = true;
  }
  return { force, dryRun, verbose, skipGlue };
}

function logv(enabled: boolean, msg: string) {
  if (enabled) console.log(msg);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function relinkNodeModules(force: boolean) {
  const { stdout } = await $({
    stdio: "pipe",
  })`nix build .#node-modules --no-link --accept-flake-config --print-out-paths`;
  const outPath = String(stdout).trim();
  if (!outPath) return;
  const linkTarget = path.join(outPath, "node_modules");
  const nm = path.join(process.cwd(), "node_modules");
  const existsNm = await exists(nm);
  if (existsNm && !(await fsp.lstat(nm)).isSymbolicLink()) {
    if (!force) {
      console.error("node_modules exists and is not a symlink. Use --force to replace.");
      process.exit(2);
    }
    await fsp.rm(nm, { recursive: true, force: true });
  }
  await fsp.symlink(linkTarget, nm).catch(async () => {
    await fsp.rm(nm, { recursive: true, force: true }).catch(() => {});
    await fsp.symlink(linkTarget, nm);
  });
}

async function sha256File(file: string): Promise<string> {
  const crypto = await import("node:crypto");
  const h = crypto.createHash("sha256");
  try {
    const buf = await fsp.readFile(file);
    h.update(buf);
    return h.digest("hex");
  } catch {
    return "";
  }
}

async function runGomod2nixGenerate(dryRun: boolean, verbose: boolean) {
  const hasGoMod = await exists("go.mod");
  const hasGoSum = await exists("go.sum");
  if (!hasGoMod && !hasGoSum) {
    console.log("[gomod2nix] skip: no go.mod or go.sum present");
    return;
  }

  const binOverride = process.env.INSTALL_DEPS_GOMOD2NIX_BIN || "";
  const cmd = binOverride ? `${binOverride} --dir .` : `nix run nixpkgs#gomod2nix -- --dir .`;
  if (dryRun) {
    console.log(`[gomod2nix] dry-run: ${cmd}`);
    return;
  }

  const beforeHash = await sha256File("gomod2nix.toml");
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "gomod2nix-"));
  try {
    if (hasGoMod) await fsp.copyFile("go.mod", path.join(tmp, "go.mod"));
    if (hasGoSum) await fsp.copyFile("go.sum", path.join(tmp, "go.sum"));
    logv(verbose, `[gomod2nix] running in ${tmp}: ${cmd}`);
    let ran = false;
    try {
      await $({ cwd: tmp, stdio: "inherit" })`bash -c ${cmd}`;
      ran = true;
    } catch (e1) {
      // Fallback 1: some nixpkgs revisions do not expose gomod2nix as an app
      const fallback1 = `nix shell nixpkgs#gomod2nix -c gomod2nix --dir .`;
      console.warn(`[gomod2nix] primary failed; trying fallback: ${fallback1}`);
      try {
        await $({ cwd: tmp, stdio: "inherit" })`bash -c ${fallback1}`;
        ran = true;
      } catch (e2) {
        // Fallback 2: upstream flake reference (nix-community)
        const fallback2 = `nix run github:nix-community/gomod2nix -- --dir .`;
        console.warn(`[gomod2nix] nixpkgs missing app; trying upstream: ${fallback2}`);
        try {
          await $({ cwd: tmp, stdio: "inherit" })`bash -c ${fallback2}`;
          ran = true;
        } catch (e3) {
          // Fallback 3: shell upstream (nix-community) and invoke binary explicitly
          const fallback3 = `nix shell github:nix-community/gomod2nix -c gomod2nix --dir .`;
          console.warn(`[gomod2nix] upstream run failed; trying shell: ${fallback3}`);
          try {
            await $({ cwd: tmp, stdio: "inherit" })`bash -c ${fallback3}`;
            ran = true;
          } catch (e4) {
            // Fallback 4: use gomod2nix from PATH if available in dev shell
            try {
              await $({
                cwd: tmp,
                stdio: "inherit",
              })`bash -c 'command -v gomod2nix >/dev/null 2>&1 && gomod2nix --dir . || exit 127'`;
              ran = true;
            } catch (e5) {
              console.error("gomod2nix not available via nix or PATH");
              throw e5;
            }
          }
        }
      }
    }
    const tmpOut = path.join(tmp, "gomod2nix.toml");
    const tmpExists = await exists(tmpOut);
    if (!tmpExists) {
      console.error("gomod2nix did not produce gomod2nix.toml");
      process.exit(3);
    }
    const next = await fsp.readFile(tmpOut, "utf8");
    const cur = (await exists("gomod2nix.toml"))
      ? await fsp.readFile("gomod2nix.toml", "utf8")
      : "";
    if (cur !== next) {
      await fsp.writeFile("gomod2nix.toml", next, "utf8");
      console.log("[gomod2nix] updated gomod2nix.toml");
    } else {
      logv(verbose, "[gomod2nix] no changes to gomod2nix.toml");
    }
  } finally {
    try {
      await fsp.rm(tmp, { recursive: true, force: true });
    } catch {}
  }
  const afterHash = await sha256File("gomod2nix.toml");
  logv(verbose, `[gomod2nix] hash ${beforeHash || "(none)"} -> ${afterHash || "(none)"}`);
}

async function have(cmd: string): Promise<boolean> {
  try {
    await $({ stdio: "pipe" })`bash -lc 'command -v ${cmd} >/dev/null 2>&1'`;
    return true;
  } catch {
    return false;
  }
}

function zxNodeBase(): string {
  const zxInit = path.resolve("tools/dev/zx-init.mjs");
  return [
    "--experimental-top-level-await",
    "--experimental-strip-types",
    "--disable-warning=ExperimentalWarning",
    "--import",
    zxInit,
  ].join(" ");
}

async function runGlue(dryRun: boolean, verbose: boolean) {
  const nodeBase = zxNodeBase();
  const nodeBin = process.execPath || "node";
  const cmds: Array<{ label: string; cmd: string; gated?: () => Promise<boolean> }> = [
    {
      label: "export-graph",
      cmd: `${nodeBin} ${nodeBase} tools/buck/export-graph.ts --out tools/buck/graph.json`,
      gated: async () => await have("buck2"),
    },
    { label: "sync-providers-go", cmd: `${nodeBin} ${nodeBase} tools/buck/sync-providers.ts` },
    {
      label: "sync-providers-node",
      cmd: `${nodeBin} ${nodeBase} tools/buck/sync-providers-node.ts`,
      gated: async () => {
        try {
          await $({ stdio: "pipe" })`git ls-files '**/pnpm-lock.yaml'`;
        } catch {
          return false;
        }
        try {
          await $({ stdio: "pipe" })`bash -lc ${`${nodeBin} -e \"require.resolve('yaml')\"`}`;
          return true;
        } catch {
          console.warn("[install-deps] yaml package missing; skipping node providers stage");
          return false;
        }
      },
    },
    {
      label: "gen-auto-map",
      cmd: `${nodeBin} ${nodeBase} tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`,
      gated: async () => await have("buck2"),
    },
  ];

  const buckPresent = await have("buck2");
  for (const c of cmds) {
    if (c.gated) {
      const ok = await c.gated();
      if (!ok) {
        if ((c.label === "export-graph" || c.label === "gen-auto-map") && !buckPresent) {
          console.warn(`[install-deps] buck2 not found; skipping ${c.label}`);
        }
        continue;
      }
    }
    if (dryRun) {
      console.log(`[dry-run] ${c.cmd}`);
    } else {
      if (verbose) console.log(`[run] ${c.cmd}`);
      await $({ stdio: "inherit" })`bash -lc ${c.cmd}`;
    }
  }
}

async function main() {
  const { force, dryRun, verbose, skipGlue } = parseFlags(process.argv.slice(2));
  await fsp.rm("node_modules", { force: true });
  await $({ stdio: "inherit" })`pnpm install --lockfile-only`;
  await $({ stdio: "inherit" })`tools/dev/update-pnpm-hash.ts`;
  await $({ stdio: "inherit" })`nix build .#node-modules --no-link --accept-flake-config`;
  await relinkNodeModules(force);
  // Advisory lint (non-strict): enforce patch path invariants without blocking setup
  try {
    const nodeBase = zxNodeBase();
    await $({ stdio: "inherit" })`bash -lc ${`node ${nodeBase} tools/dev/patches-lint.ts`}`;
  } catch {}
  await runGomod2nixGenerate(dryRun, verbose);
  if (!skipGlue) {
    await runGlue(dryRun, verbose);
  } else if (verbose) {
    console.log("[skip] glue regeneration");
  }
  console.log("Dependencies installed and node_modules linked.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
