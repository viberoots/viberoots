#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

export type TestCtx = { tmp: string; $: any };

export async function scaffoldLib(lang: string, name: string, ctx: TestCtx): Promise<void> {
  if (lang !== "go") throw new Error(`unsupported lang: ${lang}`);
  const { tmp: t, $ } = ctx;
  console.error(`[debug] scaffoldLib: setup buck config`);
  await $`bash --noprofile --norc -c ${`set -euo pipefail
      printf '.\n' > .buckroot
      cat > TARGETS <<'EOF'
platform(
    name = "no_cgo",
    constraint_values = [
        "config//go/constraints:cgo_enabled_false",
        "config//go/constraints:asan_false",
        "config//go/constraints:race_false",
    ],
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
  console.error(`[debug] scaffoldLib: run scaf new go lib ${name}`);
  await $`scaf new go lib ${name} --yes --path=libs/${name}`;
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
  })`gomod2nix --dir libs/${name}`;
  await fsp.copyFile(path.join(t, "libs", name, "gomod2nix.toml"), path.join(t, "gomod2nix.toml"));
  console.error(`[debug] scaffoldLib: seeded gomod2nix.toml via stub`);
}

export async function scaffoldApp(lang: string, name: string, ctx: TestCtx): Promise<void> {
  if (lang !== "go") throw new Error(`unsupported lang: ${lang}`);
  const { tmp: t, $ } = ctx;
  await $`bash --noprofile --norc -c ${`set -euo pipefail
      printf '.\n' > .buckroot
      cat > TARGETS <<'EOF'
platform(
    name = "no_cgo",
    constraint_values = [
        "config//go/constraints:cgo_enabled_false",
        "config//go/constraints:asan_false",
        "config//go/constraints:race_false",
    ],
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
  await $`scaf new go cli ${name} --yes --path=apps/${name}`;
  // Seed gomod2nix deterministically via local stub (no network)
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
    stdio: "inherit",
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH || ""}` },
  })`gomod2nix --dir apps/${name}`;
  await fsp.copyFile(path.join(t, "apps", name, "gomod2nix.toml"), path.join(t, "gomod2nix.toml"));
  await $({
    env: { ...process.env, INSTALL_DEPS_SKIP_GO_TIDY: "1" },
  })`tools/dev/install-deps.ts --glue-only`;
}
