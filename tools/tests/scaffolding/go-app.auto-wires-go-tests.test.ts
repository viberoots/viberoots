#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go app: adding *_test.go auto-wires nix_go_test and runs", async () => {
  // Avoid dev env export (which can trigger GitHub 429 during flake eval) by not including "go" in name
  await runInTemp("app-auto-tests", async (tmp, _$) => {
    const $ = _$({ stdio: "inherit" });
    // ensure git repo for glue scripts that use git
    await $`git init`;

    // Scaffold a Go CLI app
    await $`scaf new go cli demo-cli --yes --path=apps/demo-cli`;

    // Seed gomod2nix deterministically via local stub (no network)
    const stubDir = path.join(tmp, "bin");
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
      cwd: tmp,
      stdio: "inherit",
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH || ""}` },
    })`gomod2nix --dir apps/demo-cli`;
    await fsp.copyFile(
      path.join(tmp, "apps", "demo-cli", "gomod2nix.toml"),
      path.join(tmp, "gomod2nix.toml"),
    );

    // Add a simple *_test.go under cmd/<name>/
    const pkgDir = path.join(tmp, "apps/demo-cli/cmd/demo-cli");
    await fsp.mkdir(pkgDir, { recursive: true });
    await fsp.writeFile(
      path.join(pkgDir, "main_test.go"),
      'package main\nimport "testing"\nfunc TestMainPkg(t *testing.T){}\n',
      "utf8",
    );

    // Glue and then run the auto-wired test target
    await $`tools/dev/install-deps.ts --glue-only`;
    // Add a short, actionable external timeout message if the test stalls on stdlib
    try {
      await $`buck2 test //apps/demo-cli:demo-cli_test --target-platforms //:no_cgo`;
    } catch (e) {
      console.error(
        "go app auto-wires: buck2 test stalled or failed — ensure go stdlib toolchain built; rerun test or check Buck logs for go_build_stdlib",
      );
      throw e;
    }
  });
});
