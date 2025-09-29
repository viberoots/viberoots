#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
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

export async function runGomod2nixGenerate(dryRun: boolean, verbose: boolean) {
  await runGomod2nixGenerateIn(process.cwd(), dryRun, verbose);
}

export async function runGomod2nixGenerateIn(dir: string, dryRun: boolean, verbose: boolean) {
  const hasGoMod = await exists(path.join(dir, "go.mod"));
  const hasGoSum = await exists(path.join(dir, "go.sum"));
  if (!hasGoMod && !hasGoSum) {
    if (verbose) console.log(`[gomod2nix] skip: no go.mod or go.sum in ${dir}`);
    return;
  }

  const binOverride =
    process.env.INSTALL_DEPS_GOMOD2NIX_BIN || path.join(process.cwd(), "tools", "bin", "gomod2nix");
  const cmd = `${binOverride} --dir .`;
  if (dryRun) {
    console.log(`[gomod2nix] dry-run (${dir}): ${cmd}`);
    return;
  }

  const beforeHash = await sha256File(path.join(dir, "gomod2nix.toml"));
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "gomod2nix-"));
  try {
    if (hasGoMod) await fsp.copyFile(path.join(dir, "go.mod"), path.join(tmp, "go.mod"));
    if (hasGoSum) await fsp.copyFile(path.join(dir, "go.sum"), path.join(tmp, "go.sum"));
    if (verbose) console.log(`[gomod2nix] running in ${tmp} for ${dir}: ${cmd}`);
    try {
      await $({ cwd: tmp, stdio: "inherit" })`bash -c ${cmd}`;
    } catch (e1) {
      const fallback1 = `nix shell nixpkgs#gomod2nix -c gomod2nix --dir .`;
      console.warn(`[gomod2nix] primary failed; trying fallback: ${fallback1}`);
      try {
        await $({ cwd: tmp, stdio: "inherit" })`bash -c ${fallback1}`;
      } catch (e2) {
        const fallback2 = `nix run github:nix-community/gomod2nix -- --dir .`;
        console.warn(`[gomod2nix] nixpkgs missing app; trying upstream: ${fallback2}`);
        try {
          await $({ cwd: tmp, stdio: "inherit" })`bash -c ${fallback2}`;
        } catch (e3) {
          const fallback3 = `nix shell github:nix-community/gomod2nix -c gomod2nix --dir .`;
          console.warn(`[gomod2nix] upstream run failed; trying shell: ${fallback3}`);
          try {
            await $({ cwd: tmp, stdio: "inherit" })`bash -c ${fallback3}`;
          } catch (e4) {
            try {
              await $({
                cwd: tmp,
                stdio: "inherit",
              })`bash -c 'command -v gomod2nix >/dev/null 2>&1 && gomod2nix --dir . || exit 127'`;
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
    const dst = path.join(dir, "gomod2nix.toml");
    const cur = (await exists(dst)) ? await fsp.readFile(dst, "utf8") : "";
    if (cur !== next) {
      await fsp.writeFile(dst, next, "utf8");
      console.log(`[gomod2nix] updated ${path.relative(process.cwd(), dst)}`);
    } else if (verbose) {
      console.log(`[gomod2nix] no changes: ${path.relative(process.cwd(), dst)}`);
    }
  } finally {
    try {
      await fsp.rm(tmp, { recursive: true, force: true });
    } catch {}
  }
  const afterHash = await sha256File(path.join(dir, "gomod2nix.toml"));
  if (verbose)
    console.log(
      `[gomod2nix] hash (${path.relative(process.cwd(), dir)}): ${afterHash || "(none)"}`,
    );
}

export async function runGomod2nixScanAll(dryRun: boolean, verbose: boolean) {
  // Scan for go.mod under apps/* and libs/* and generate per-module gomod2nix.toml
  const roots = [path.join(process.cwd(), "apps"), path.join(process.cwd(), "libs")];
  const dirs: string[] = [];
  for (const r of roots) {
    try {
      const entries = await fsp.readdir(r, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          const d = path.join(r, e.name);
          if (await exists(path.join(d, "go.mod"))) dirs.push(d);
        }
      }
    } catch {}
  }
  for (const d of dirs) {
    await runGomod2nixGenerateIn(d, dryRun, verbose);
  }
}
