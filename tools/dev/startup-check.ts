#!/usr/bin/env zx-wrapper
// tools/dev/startup-check.ts — verifies required tools and Nix features; prints fallbacks
import fs from "fs-extra";
import semver from "semver";

async function which(cmd: string) { try { await $`which ${cmd}`; return true; } catch { return false; } }

async function main() {
  const need = ["pnpm","git","go","buck2","nix"];
  const miss: string[] = [];
  for (const b of need) if (!(await which(b))) miss.push(b);
  if (miss.length) { console.error("Missing tools on PATH:", miss.join(", ")); process.exit(1); }

  const pkg = await fs.readJSON("package.json");
  const req = pkg.engines?.node as string | undefined;
  if (req && !semver.satisfies(process.versions.node, req, { includePrerelease: true })) {
    console.error(`Node ${process.versions.node} does not satisfy engines.node=${req}`);
    process.exit(1);
  }

  const required = ["dynamic-derivations", "ca-derivations", "recursive-nix"];
  try {
    const { stdout } = await $`nix show-config`;
    const text = String(stdout).toLowerCase();
    let ok = required.every(k => text.includes(k));
    if (!ok) {
      const cfg = (process.env.NIX_CONFIG || '').toLowerCase();
      ok = required.every(k => cfg.includes(k));
    }
    if (!ok) {
      console.error("[startup-check] nix experimental features must include: dynamic-derivations ca-derivations recursive-nix");
      process.exit(1);
    }
  } catch {
    console.error("[startup-check] cannot read nix config via `nix show-config`");
    process.exit(1);
  }

  if (process.platform === "linux") {
    const hasFuse = await which("fuse-overlayfs");
    if (!hasFuse) console.info("[startup-check] fuse-overlayfs not found; patch workspaces will fallback to cp -a");
  } else if (process.platform === "darwin") {
    console.info("[startup-check] macOS will use APFS CoW (cp -cR) when available; fallback to cp -a");
  }
  
  if ((process.env.NIX_GO_DEV_OVERRIDE_JSON || '').trim() !== '') {
    console.warn("\n[OVERRIDES ACTIVE] NIX_GO_DEV_OVERRIDE_JSON is set — local derivation hashes will differ. Unset before sharing cache artifacts.\n");
  }
  console.log("startup-check: OK");
}

main().catch(e => { console.error(e); process.exit(1); });
