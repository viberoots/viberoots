#!/usr/bin/env zx-wrapper
// tools/dev/startup-check.ts — verifies required tools and Nix features; prints fallbacks
import * as fsp from "node:fs/promises";

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

  // Python enablement prerequisites (PR-14): python3 and uv
  const isCI = (process.env.CI || "").toLowerCase() === "true";
  const fakeMissing = String(process.env.STARTUP_CHECK_FAKE_MISSING || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const hasPython3 = fakeMissing.includes("python3") ? false : await which("python3");
  const hasUv = fakeMissing.includes("uv") ? false : await which("uv");
  if (!hasPython3 || !hasUv) {
    const missing = [!hasPython3 ? "python3" : "", !hasUv ? "uv" : ""].filter(Boolean);
    const msg =
      "[startup-check] missing tools: " +
      missing.join(", ") +
      ". Install via dev shell (direnv/nix).";
    if (isCI) {
      console.error(msg);
      process.exit(1);
    } else {
      console.warn(msg);
    }
  }

  // Minimal engines.node check without external deps (supports only ">=x.y.z")
  try {
    const pkgTxt = await fsp.readFile("package.json", "utf8");
    const pkg = JSON.parse(pkgTxt) as any;
    const required = String(pkg?.engines?.node || "").trim();
    if (required.startsWith(">=")) {
      const want = required.slice(2).trim();
      const parse = (v: string) => {
        const [maj, min, pat] = v.replace(/^v/, "").split(".");
        return {
          major: Number(maj || 0),
          minor: Number(min || 0),
          patch: Number((pat || "0").split("-")[0] || 0),
        };
      };
      const a = parse(process.versions.node);
      const b = parse(want);
      const ok =
        a.major > b.major ||
        (a.major === b.major && (a.minor > b.minor || (a.minor === b.minor && a.patch >= b.patch)));
      if (!ok) {
        console.error(`Node ${process.versions.node} does not satisfy engines.node=${required}`);
        process.exit(1);
      }
    }
  } catch {}

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
  if ((process.env.NIX_PY_DEV_OVERRIDE_JSON || "").trim() !== "") {
    console.warn(
      "\n[OVERRIDES ACTIVE] NIX_PY_DEV_OVERRIDE_JSON is set — local derivation hashes will differ. Unset before sharing cache artifacts.\n",
    );
  }

  // Verify Buck prelude/cell mapping exists (diagnostic only; do not write files)
  try {
    const buckconfig = await fsp.readFile(".buckconfig", "utf8");
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
