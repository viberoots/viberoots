#!/usr/bin/env zx-wrapper
// build-tools/tools/dev/startup-check.ts — verifies required tools and Nix features; prints fallbacks
import * as fsp from "node:fs/promises";
import { isNixStorePath, resolvePreferredCmdPath } from "./startup-check/cmd-paths.ts";
import { DEV_OVERRIDE_LANGS, devOverrideEnvNameForLang } from "../lib/dev-override-envs.ts";

async function which(cmd: string) {
  try {
    await $`which ${cmd}`;
    return true;
  } catch {
    return false;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // Only require the glue/orchestrator tools that the repo workflows depend on.
  // Language-specific toolchains (go/python/etc) are optional: if present they must
  // be nix-provided, but missing tools should not break sparse/partial clones.
  const need = ["pnpm", "git", "buck2", "nix"];
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

  // Python enablement prerequisites: python3 and uv.
  // These should only be required when Python is actually present in the checkout.
  // Do NOT require developers to edit configs (e.g. langs.json) for sparse/partial clones.
  const isCI = (process.env.CI || "").toLowerCase() === "true";
  const pythonPresent =
    (await pathExists("python/defs.bzl")) ||
    (await pathExists("build-tools/tools/nix/templates/python.nix")) ||
    (await pathExists("build-tools/tools/buck/exporter/lang/python.ts")) ||
    (await pathExists("build-tools/tools/buck/providers/python.ts"));

  const fakeMissing = String(process.env.STARTUP_CHECK_FAKE_MISSING || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Policy: tools are optional in local dev, but must be present in CI when the
  // language is present in the checkout (to prevent "it works locally" drift).
  if (isCI && pythonPresent) {
    const hasPython3 = fakeMissing.includes("python3") ? false : await which("python3");
    const hasUv = fakeMissing.includes("uv") ? false : await which("uv");
    if (!hasPython3 || !hasUv) {
      const missing = [!hasPython3 ? "python3" : "", !hasUv ? "uv" : ""].filter(Boolean);
      const msg =
        "[startup-check] missing tools: " +
        missing.join(", ") +
        ". Install via dev shell (direnv/nix).";
      console.error(msg);
      process.exit(1);
    }
  }

  // Enforce that core toolchains come from /nix/store when present.
  // This is the project guarantee behind "built by nix-supplied tools".
  const allowNonStore = (process.env.STARTUP_CHECK_ALLOW_NON_NIX_STORE || "").trim() !== "";
  if (!allowNonStore) {
    // Note: do not enforce buck2's path here. In Buck-run contexts (e.g. zx_test),
    // `buck2` may be a repo-local shim script under buck-out/ that delegates to the
    // real nix-supplied buck2 binary.
    // Required tools should be nix-provided in all environments.
    // Optional language toolchains are only enforced in CI when that language is present.
    const mustBeStore = ["nix", "node", "pnpm", "go"].concat(
      isCI && pythonPresent ? ["python3", "uv"] : [],
    );
    const bad: Array<{ cmd: string; path: string }> = [];
    for (const cmd of mustBeStore) {
      const p = await resolvePreferredCmdPath(cmd);
      if (!p) continue;
      if (!isNixStorePath(p)) bad.push({ cmd, path: p });
    }
    if (bad.length) {
      const msg =
        "[startup-check] non-Nix toolchain detected (expected /nix/store paths). " +
        bad.map((b) => `${b.cmd}=${b.path}`).join(" ");
      console.error(msg);
      process.exit(1);
    }

    // Local-only advisory: when Python is present in the checkout but CI enforcement is off,
    // do not fail if the system toolchain is on PATH first.
    if (!isCI && pythonPresent) {
      const p3 = await resolvePreferredCmdPath("python3");
      const uv = await resolvePreferredCmdPath("uv");
      const warns: Array<{ cmd: string; path: string }> = [];
      if (p3 && !isNixStorePath(p3)) warns.push({ cmd: "python3", path: p3 });
      if (uv && !isNixStorePath(uv)) warns.push({ cmd: "uv", path: uv });
      if (warns.length) {
        console.warn(
          "[startup-check] warning: non-Nix python toolchain on PATH. Local dev is OK; CI will enforce it. " +
            warns.map((w) => `${w.cmd}=${w.path}`).join(" "),
        );
      }
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

  for (const lang of DEV_OVERRIDE_LANGS) {
    const envName = devOverrideEnvNameForLang(lang);
    if ((process.env[envName] || "").trim() === "") continue;
    console.warn(
      `\n[OVERRIDES ACTIVE] ${envName} is set — local derivation hashes will differ. Unset before sharing cache artifacts.\n`,
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
