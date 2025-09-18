#!/usr/bin/env zx-wrapper
// tools/dev/startup-check.ts — verifies required tools and Nix features; prints fallbacks
import fs from "fs-extra";
import semver from "semver";

async function which(cmd: string) {
  try {
    await $`which ${cmd}`;
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const need = ["pnpm", "git", "go", "buck2", "nix"];
  const miss: string[] = [];
  for (const b of need) {
    if (!(await which(b))) {
      miss.push(b);
    }
  }
  if (miss.length) {
    console.error("Missing tools on PATH:", miss.join(", "));
    process.exit(1);
  }

  const pkg = await fs.readJSON("package.json");
  const req = pkg.engines?.node as string | undefined;
  if (req && !semver.satisfies(process.versions.node, req, { includePrerelease: true })) {
    console.error(`Node ${process.versions.node} does not satisfy engines.node=${req}`);
    process.exit(1);
  }

  const must = ["dynamic-derivations", "recursive-nix"];
  const nice = ["ca-derivations"];
  try {
    const { stdout } = await $`nix show-config`;
    const text = String(stdout).toLowerCase();
    const have = (k: string) =>
      text.includes(k) || (process.env.NIX_CONFIG || "").toLowerCase().includes(k);
    const hardOk = must.every(have);
    if (!hardOk) {
      console.error(
        "[startup-check] nix experimental features must include: dynamic-derivations recursive-nix",
      );
      process.exit(1);
    }
    const softOk = nice.every(have);
    if (!softOk) {
      console.warn(
        "[startup-check] warning: ca-derivations not enabled. Local dev is OK; CI will enforce it.",
      );
    }
  } catch {
    console.error("[startup-check] cannot read nix config via `nix show-config`");
    process.exit(1);
  }

  // No overlayfs requirement: patch workspaces use cp -cR on macOS when available, else cp -a.

  if ((process.env.NIX_GO_DEV_OVERRIDE_JSON || "").trim() !== "") {
    console.warn(
      "\n[OVERRIDES ACTIVE] NIX_GO_DEV_OVERRIDE_JSON is set — local derivation hashes will differ. Unset before sharing cache artifacts.\n",
    );
  }

  // Ensure Buck prelude alias exists so @prelude loads work even outside dev shell
  try {
    const buckconfig = await fs.readFile(".buckconfig", "utf8");
    const hasPrelude = /\[repositories\][\s\S]*?^\s*prelude\s*=\s*/m.test(buckconfig);
    if (!hasPrelude) {
      console.warn(
        "[startup-check] .buckconfig missing [repositories] prelude mapping; run 'nix develop' or add the alias so @prelude//go:def.bzl resolves.",
      );
    }
  } catch {
    console.warn(
      "[startup-check] .buckconfig not found; run 'nix develop' to generate it or ensure prelude alias exists.",
    );
  }

  // Preflight: ensure pnpm-store fixed-output hash is correct so shellHook/node-modules won't rebuild repeatedly.
  try {
    await $`nix build .#pnpm-store --no-link --accept-flake-config`;
  } catch (e: any) {
    const out = String((e && e.stderr) || (e && e.stdout) || e || "");
    if (/hash mismatch in fixed-output derivation/i.test(out)) {
      console.error(
        "[startup-check] pnpm-store fixed-output hash mismatch detected.\n" +
          "Run: tools/dev/update-pnpm-hash.ts\n",
      );
    } else {
      console.error(
        "[startup-check] pnpm-store build failed; see error below and consider updating the hash via update-pnpm-hash.ts\n\n" +
          out,
      );
    }
    process.exit(1);
  }
  console.log("startup-check: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
