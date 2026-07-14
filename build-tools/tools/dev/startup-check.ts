#!/usr/bin/env zx-wrapper
// build-tools/tools/dev/startup-check.ts — verifies required tools and Nix features; prints fallbacks
import * as fsp from "node:fs/promises";
import path from "node:path";
import { isNixStorePath, resolvePreferredCmdPath } from "./startup-check/cmd-paths";
import { validateStartupWorkspaceState } from "./startup-check/workspace-state";
import { isVbrVerbose } from "../lib/command-ui";
import { DEV_OVERRIDE_LANGS, devOverrideEnvNameForLang } from "../lib/dev-override-envs";
import { withSanitizedInheritedNixConfig } from "../lib/nix-config-env";
import {
  ensureNixStoreToolPathSync,
  envWithResolvedNixBin,
  resolveToolPathSync,
} from "../lib/tool-paths";

async function which(cmd: string) {
  return Boolean(await resolvePreferredCmdPath(cmd));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

function selectedNixEnv(extraEnv: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return withSanitizedInheritedNixConfig(
    envWithResolvedNixBin({
      ...process.env,
      ...extraEnv,
    }),
  );
}

async function sourceRoot(): Promise<string> {
  const envRoot = String(
    process.env.VIBEROOTS_SOURCE_ROOT || process.env.VIBEROOTS_ROOT || "",
  ).trim();
  if (envRoot) return envRoot;
  if (await pathExists(path.join("viberoots", "build-tools"))) return path.resolve("viberoots");
  return process.cwd();
}

async function materializeBuckPrelude(
  flakeRoot: string,
  preludeLink: string,
  sourceLabel: string,
): Promise<void> {
  let canReplace = false;
  try {
    const stat = await fsp.lstat(preludeLink);
    canReplace = stat.isSymbolicLink();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    canReplace = true;
  }
  if (!canReplace) {
    throw new Error(`[startup-check] invalid Buck prelude: ${preludeLink} is not a symlink`);
  }

  const nixEnv = selectedNixEnv();
  const nixBin = resolveToolPathSync("nix", nixEnv);
  const built = await $({
    cwd: flakeRoot,
    stdio: "pipe",
    env: nixEnv,
  })`${nixBin} build --impure ${`path:${flakeRoot}#buck2-prelude`} --no-link --no-write-lock-file --accept-flake-config --print-out-paths`.nothrow();
  if (built.exitCode !== 0) {
    const stderr = String(built.stderr || "").trim();
    throw new Error(
      [
        `[startup-check] failed to build Buck prelude from ${sourceLabel}`,
        stderr ? `nix stderr:\n${stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  const outPath =
    String(built.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop() || "";
  const target = path.join(outPath, "prelude");
  if (!(await pathExists(path.join(target, "prelude.bzl")))) {
    throw new Error(`[startup-check] failed to materialize Buck prelude from ${sourceLabel}`);
  }
  await fsp.mkdir(path.dirname(preludeLink), { recursive: true });
  await fsp.unlink(preludeLink).catch((e) => {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  });
  await fsp.symlink(target, preludeLink);
}

async function repairBuckPrelude(workspaceRoot: string, source: string): Promise<void> {
  const workspaceFlake = path.join(workspaceRoot, ".viberoots", "workspace");
  if (await pathExists(path.join(workspaceFlake, "flake.nix"))) {
    if (await pathExists(path.join(workspaceFlake, "prelude", "prelude.bzl"))) return;
    await materializeBuckPrelude(
      workspaceFlake,
      path.join(workspaceFlake, "prelude"),
      ".viberoots/workspace#buck2-prelude",
    );
    return;
  }

  if (!(await pathExists(sourcePath(source, "build-tools/tools/nix/buck-prelude.nix")))) return;
  if (await pathExists(sourcePath(source, "prelude/prelude.bzl"))) return;
  await materializeBuckPrelude(source, sourcePath(source, "prelude"), "#buck2-prelude");
}

function sourcePath(root: string, ...parts: string[]): string {
  return path.join(root, ...parts);
}

async function requireImpureEnvPassthrough() {
  const probe = "__vbr_impure_env_probe__";
  const env = selectedNixEnv({ BUCK_TARGET: probe });
  const res = await $({
    stdio: "pipe",
    env,
  })`${resolveToolPathSync("nix", env)} eval --impure --raw --expr ${'builtins.getEnv "BUCK_TARGET"'}`.nothrow();
  if (res.exitCode !== 0) {
    console.error(
      "[startup-check] failed to verify impure env passthrough via `nix eval --impure`",
    );
    process.exit(1);
  }
  const seen = String(res.stdout || "").trim();
  if (seen !== probe) {
    console.error(
      "[startup-check] impure env passthrough is blocked for BUCK_TARGET. Check Nix policy and flake-config trust for allowed-impure-env-vars.",
    );
    process.exit(1);
  }
}

async function main() {
  const source = await sourceRoot();

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
  const pythonPresent =
    (await pathExists(sourcePath(source, "build-tools/python/defs.bzl"))) ||
    (await pathExists(sourcePath(source, "build-tools/tools/nix/templates/python.nix"))) ||
    (await pathExists(sourcePath(source, "build-tools/tools/buck/exporter/lang/python.ts"))) ||
    (await pathExists(sourcePath(source, "build-tools/tools/buck/providers/python.ts")));

  const fakeMissing = String(process.env.STARTUP_CHECK_FAKE_MISSING || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (pythonPresent) {
    const failures: string[] = [];
    for (const tool of ["python3", "uv"]) {
      if (fakeMissing.includes(tool)) {
        failures.push(`${tool}=missing`);
        continue;
      }
      try {
        ensureNixStoreToolPathSync(tool);
      } catch (error) {
        failures.push(String((error as Error).message || error));
      }
    }
    if (failures.length) {
      console.error(
        `[startup-check] Python toolchain must come from the Nix dev shell: ${failures.join("; ")}`,
      );
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
    const mustBeStore = ["nix", "node", "pnpm", "go"];
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
  }

  // Minimal engines.node check without external deps (supports only ">=x.y.z")
  try {
    const pkgTxt = await fsp.readFile(sourcePath(source, "package.json"), "utf8");
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
    const nixEnv = selectedNixEnv();
    const nixBin = resolveToolPathSync("nix", nixEnv);
    const { stdout } = await $({ env: nixEnv })`${nixBin} config show`;
    const configText = String(stdout).toLowerCase();
    const envText = (process.env.NIX_CONFIG || "").toLowerCase();
    const configFeatureParts = Array.from(
      configText.matchAll(/(?:^|\n)\s*(?:extra-)?experimental-features\s*=\s*([^\n]*)/g),
    ).map((m) => String(m[1] || ""));
    const merged = configFeatureParts.concat(envText).join(" ").trim();
    const features = new Set(
      merged
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
    // `nix config show` itself requires the modern CLI path.
    features.add("nix-command");
    if (!features.has("flakes")) {
      const flakeHelp = await $({ env: nixEnv })`${nixBin} flake metadata --help`.nothrow();
      if (flakeHelp.exitCode === 0) {
        features.add("flakes");
      }
    }

    if (!features.has("nix-command")) {
      console.error("[startup-check] missing nix experimental feature: nix-command");
      process.exit(1);
    }
    if (!features.has("flakes")) {
      console.error("[startup-check] missing nix experimental feature: flakes");
      process.exit(1);
    }
    // Implementation-required feature floor: nix-command + flakes.
    // Do not require dynamic-derivations/recursive-nix/ca-derivations here; those are policy-level choices.
  } catch (error) {
    const detail = String(
      (error as { stderr?: unknown; message?: unknown }).stderr ||
        (error as { message?: unknown }).message ||
        error,
    ).trim();
    console.error(
      `[startup-check] cannot read nix config via \`nix config show\`${detail ? `: ${detail}` : ""}`,
    );
    process.exit(1);
  }

  await requireImpureEnvPassthrough();

  // No overlayfs requirement: patch workspaces use cp -cR on macOS when available, else cp -a.

  try {
    await repairBuckPrelude(process.cwd(), source);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  for (const lang of DEV_OVERRIDE_LANGS) {
    const envName = devOverrideEnvNameForLang(lang);
    if ((process.env[envName] || "").trim() === "") continue;
    console.warn(
      `\n[OVERRIDES ACTIVE] ${envName} is set — local derivation hashes will differ. Unset before sharing cache artifacts.\n`,
    );
  }

  try {
    await validateStartupWorkspaceState();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  if (isVbrVerbose()) {
    console.log("startup-check: OK");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
