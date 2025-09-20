#!/usr/bin/env zx-wrapper
import path from "node:path";
import "zx/globals";

function shouldInstallDeps(): boolean {
  // Placeholder for future heuristics (node_modules symlink, gomod2nix freshness, etc.)
  return true;
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

async function ensureBuckPreludeConfig(): Promise<void> {
  try {
    const { stdout } = await $({
      stdio: "pipe",
    })`nix build .#buck2-prelude --no-link --accept-flake-config --print-out-paths`;
    const out = String(stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop();
    if (!out) throw new Error("unable to build .#buck2-prelude");
    const preludePath = `${out}/prelude`;
    await $`bash -lc ${`set -euo pipefail
      : > .buckroot
      rm -f prelude && ln -s "${preludePath}" prelude
      cat > .buckconfig <<'EOF'
[buildfile]
name = TARGETS

[repositories]
root = .
prelude = ./prelude
 toolchains = ./toolchains
 repo_toolchains = ./toolchains
fbsource = ./prelude/third-party/fbsource_stub
fbcode = ./prelude/third-party/fbcode_stub
config = ./prelude

[cells]
root = .
prelude = ./prelude
 toolchains = ./toolchains
 repo_toolchains = ./toolchains
fbsource = ./prelude/third-party/fbsource_stub
fbcode = ./prelude/third-party/fbcode_stub
config = ./prelude

[build]
prelude = prelude
user_platform = prelude//platforms:default
target_platforms = prelude//platforms:default
EOF
    `}`;

    // Ensure toolchains/ has its own .buckconfig so Buck uses TARGETS there too
    await $`bash -lc ${`set -euo pipefail
      mkdir -p toolchains
      cat > toolchains/.buckconfig <<'EOF'
[buildfile]
name = TARGETS
EOF
    `}`;
  } catch (e) {
    console.error("failed to ensure Buck prelude config:", e);
    throw e;
  }
}

async function main() {
  const isCI = process.env.CI === "true";
  const argsIn = process.argv.slice(2);
  const known = new Set([
    "build",
    "test",
    "run",
    "cquery",
    "query",
    "install",
    "kill",
    "server",
    "clean",
  ]);
  let subcmd = "build";
  let restArgs = argsIn;
  if (argsIn.length === 0) {
    restArgs = ["//..."];
  } else if (known.has(argsIn[0])) {
    subcmd = argsIn[0];
    restArgs = argsIn.slice(1);
  } else if (/^(?:\/\/|root\/\/|:)/.test(argsIn[0])) {
    // Treat bare target form as `buck2 build <targets...>`
    subcmd = "build";
    restArgs = argsIn;
  } else {
    // Fallback: pass through, but default to build if unrecognized
    subcmd = "build";
    restArgs = argsIn;
  }

  // Environment guard: ensure required tools and Nix features are present
  await $({ stdio: "inherit" })`tools/dev/startup-check.ts`;

  // Ensure Buck prelude and config are aligned to flake buck2-prelude
  await ensureBuckPreludeConfig();

  if (!isCI && shouldInstallDeps()) {
    const nodeBase = zxNodeBase();
    const nodeBin = process.execPath || "node";
    await $({
      stdio: "inherit",
    })`bash --noprofile --norc -c ${`${nodeBin} ${nodeBase} tools/dev/install-deps.ts --glue-only`}`;
  }

  async function findBuckBin(): Promise<string> {
    // Use PATH (shellHook ensures upstream buck2 is first on PATH)
    return "buck2";
  }
  const buckBin = await findBuckBin();
  const platformFlags = ["--target-platforms", "prelude//platforms:default"];
  const cmd = `${buckBin} ${subcmd} ${platformFlags.join(" ")} ${restArgs.join(" ")}`;
  process.env.BUCK_ROOT = process.cwd();
  const proc = await $({ stdio: "inherit" })`bash --noprofile --norc -c ${cmd}`.catch((e) => e);
  const code = typeof proc?.exitCode === "number" ? proc.exitCode : 1;
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
