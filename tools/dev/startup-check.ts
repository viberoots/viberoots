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

  try {
    const { stdout } = await $`nix show-config`;
    const configText = String(stdout).toLowerCase();
    const envText = (process.env.NIX_CONFIG || "").toLowerCase();
    const expLine =
      configText.split(/\n/).find((l) => l.trim().startsWith("experimental-features =")) || "";
    const merged = [expLine.split("=").slice(1).join("=") || "", envText].join(" ").trim();
    const features = new Set(
      merged
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    );

    if (!features.has("nix-command")) {
      console.error("[startup-check] missing nix experimental feature: nix-command");
      process.exit(1);
    }
    if (!features.has("flakes")) {
      console.error("[startup-check] missing nix experimental feature: flakes");
      process.exit(1);
    }
    if (!features.has("dynamic-derivations")) {
      console.error("[startup-check] missing nix experimental feature: dynamic-derivations");
      process.exit(1);
    }
    if (!features.has("recursive-nix")) {
      console.error("[startup-check] missing nix experimental feature: recursive-nix");
      process.exit(1);
    }

    if (!features.has("ca-derivations")) {
      if ((process.env.CI || "").toLowerCase() === "true") {
        console.error(
          "[startup-check] missing nix experimental feature: ca-derivations (required in CI)",
        );
        process.exit(1);
      } else {
        console.warn(
          "[startup-check] warning: ca-derivations not enabled. Local dev is OK; CI will enforce it.",
        );
      }
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
  if ((process.env.NIX_CPP_DEV_OVERRIDE_JSON || "").trim() !== "") {
    console.warn(
      "\n[OVERRIDES ACTIVE] NIX_CPP_DEV_OVERRIDE_JSON is set — local derivation hashes will differ. Unset before sharing cache artifacts.\n",
    );
  }

  // Verify Buck prelude/cell mapping exists (diagnostic only; do not write files)
  try {
    const buckconfig = await fs.readFile(".buckconfig", "utf8");
    const hasPrelude = /\[repositories\][\s\S]*?^\s*prelude\s*=\s*/m.test(buckconfig);
    const hasCellsPrelude = /\[cells\][\s\S]*?^\s*prelude\s*=\s*/m.test(buckconfig);
    if (!hasPrelude || !hasCellsPrelude) {
      console.error(
        "[startup-check] invalid .buckconfig: missing prelude mapping in [repositories] or [cells]. Run 'nix develop' to provision or fix the mapping.",
      );
      process.exit(1);
    }
  } catch {
    console.error(
      "[startup-check] .buckconfig not found; run 'nix develop' to generate it. Exporter will fail without a valid prelude mapping.",
    );
    process.exit(1);
  }

  console.log("startup-check: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
