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
  const hasGoMod = await exists("go.mod");
  const hasGoSum = await exists("go.sum");
  if (!hasGoMod && !hasGoSum) {
    console.log("[gomod2nix] skip: no go.mod or go.sum present");
    return;
  }

  const binOverride =
    process.env.INSTALL_DEPS_GOMOD2NIX_BIN || path.join(process.cwd(), "tools", "bin", "gomod2nix");
  const cmd = `${binOverride} --dir .`;
  if (dryRun) {
    console.log(`[gomod2nix] dry-run: ${cmd}`);
    return;
  }

  const beforeHash = await sha256File("gomod2nix.toml");
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "gomod2nix-"));
  try {
    if (hasGoMod) await fsp.copyFile("go.mod", path.join(tmp, "go.mod"));
    if (hasGoSum) await fsp.copyFile("go.sum", path.join(tmp, "go.sum"));
    if (verbose) console.log(`[gomod2nix] running in ${tmp}: ${cmd}`);
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
    const cur = (await exists("gomod2nix.toml"))
      ? await fsp.readFile("gomod2nix.toml", "utf8")
      : "";
    if (cur !== next) {
      await fsp.writeFile("gomod2nix.toml", next, "utf8");
      console.log("[gomod2nix] updated gomod2nix.toml");
    } else if (verbose) {
      console.log("[gomod2nix] no changes to gomod2nix.toml");
    }
  } finally {
    try {
      await fsp.rm(tmp, { recursive: true, force: true });
    } catch {}
  }
  const afterHash = await sha256File("gomod2nix.toml");
  if (verbose)
    console.log(`[gomod2nix] hash ${beforeHash || "(none)"} -> ${afterHash || "(none)"}`);
}
