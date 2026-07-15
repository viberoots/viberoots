#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { ensureBuckConfigForTempRepo } from "./test-helpers/buck-config";

export type TestCtx = { tmp: string; $: any };

export async function scaffoldLib(lang: string, name: string, ctx: TestCtx): Promise<boolean> {
  if (lang !== "go") throw new Error(`unsupported lang: ${lang}`);
  const { tmp: t, $ } = ctx;
  const flakePath = path.join(t, "flake.lock");
  try {
    await fsp.access(flakePath);
  } catch {
    const repoRoot = process.env.REPO_ROOT || process.cwd();
    try {
      await fsp.copyFile(path.join(repoRoot, "flake.lock"), flakePath);
    } catch {
      await fsp.writeFile(flakePath, "{}\n", "utf8");
    }
  }
  await $`bash --noprofile --norc -c ${`set -euo pipefail
      printf '.\n' > .buckroot
      test -f flake.lock || printf "{}\n" > flake.lock
      cat > TARGETS <<'EOF'
load("@prelude//:rules.bzl", "export_file")

platform(
    name = "no_cgo",
    constraint_values = [
        "config//go/constraints:cgo_enabled_false",
        "config//go/constraints:asan_false",
        "config//go/constraints:race_false",
    ],
    visibility = ["PUBLIC"],
)

export_file(
    name = "flake.lock",
    src = "flake.lock",
    visibility = ["PUBLIC"],
)
EOF
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
default_platform = //:no_cgo
user_platform = //:no_cgo
target_platforms = //:no_cgo
EOF
      mkdir -p toolchains
      printf '[buildfile]\nname = TARGETS\n' > toolchains/.buckconfig
    `}`;
  await ensureBuckConfigForTempRepo(t, $);
  await $`scaf new go lib ${name} --yes --path=projects/libs/${name}`;
  if (!(await fsp.stat(path.join(t, "projects", "libs", name, "go.mod")).catch(() => null))) {
    return false;
  }
  // Seed gomod2nix deterministically via local stub to avoid network
  const stubDir = path.join(t, "bin");
  await fsp.mkdir(stubDir, { recursive: true });
  const stubPath = path.join(stubDir, "gomod2nix");
  await fsp.writeFile(
    stubPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "DIR=.",
      "while [[ $# -gt 0 ]]; do",
      '  case "$1" in',
      "    --dir)",
      '      DIR="$2"; shift 2;;',
      "    *) shift;;",
      "  esac",
      "done",
      'mkdir -p "$DIR"',
      "cat > \"$DIR/gomod2nix.toml\" <<'EOF'",
      "schema = 3",
      "mod = {}",
      "replace = {}",
      "prune = { go-tests = true, unused-packages = true }",
      "EOF",
    ].join("\n"),
    "utf8",
  );
  await $`chmod +x ${stubPath}`;
  await $({
    cwd: t,
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH || ""}` },
  })`gomod2nix --dir projects/libs/${name}`;
  await fsp.copyFile(
    path.join(t, "projects", "libs", name, "gomod2nix.toml"),
    path.join(t, "gomod2nix.toml"),
  );
  return true;
}

export async function scaffoldApp(lang: string, name: string, ctx: TestCtx): Promise<boolean> {
  if (lang !== "go") throw new Error(`unsupported lang: ${lang}`);
  const { tmp: t, $ } = ctx;
  const flakePath = path.join(t, "flake.lock");
  try {
    await fsp.access(flakePath);
  } catch {
    const repoRoot = process.env.REPO_ROOT || process.cwd();
    try {
      await fsp.copyFile(path.join(repoRoot, "flake.lock"), flakePath);
    } catch {
      await fsp.writeFile(flakePath, "{}\n", "utf8");
    }
  }
  await $`bash --noprofile --norc -c ${`set -euo pipefail
      printf '.\n' > .buckroot
      test -f flake.lock || printf "{}\n" > flake.lock
      cat > TARGETS <<'EOF'
load("@prelude//:rules.bzl", "export_file")

platform(
    name = "no_cgo",
    constraint_values = [
        "config//go/constraints:cgo_enabled_false",
        "config//go/constraints:asan_false",
        "config//go/constraints:race_false",
    ],
    visibility = ["PUBLIC"],
)

export_file(
    name = "flake.lock",
    src = "flake.lock",
    visibility = ["PUBLIC"],
)
EOF
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
default_platform = //:no_cgo
user_platform = //:no_cgo
target_platforms = //:no_cgo
EOF
      mkdir -p toolchains
      printf '[buildfile]\nname = TARGETS\n' > toolchains/.buckconfig
    `}`;
  await ensureBuckConfigForTempRepo(t, $);
  await $`scaf new go cli ${name} --yes --path=projects/apps/${name}`;
  if (!(await fsp.stat(path.join(t, "projects", "apps", name, "go.mod")).catch(() => null))) {
    return false;
  }
  await $`viberoots/build-tools/tools/bin/u`;
  await $`viberoots/build-tools/tools/dev/install-deps.ts --glue-only`;
  return true;
}
