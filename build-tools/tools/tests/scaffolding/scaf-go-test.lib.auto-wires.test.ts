#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("scaf go test: lib auto-wires *_test.go under pkg/**", async () => {
  // Avoid dev env export path
  await runInTemp("scaf-test-lib", async (tmp, _$) => {
    const $ = _$({ stdio: "inherit" });
    // ensure git repo for glue scripts that use git
    await $`git init`;
    // Scaffold a Go library
    await $`scaf new go lib demo-lib --yes --path=projects/libs/demo-lib`;
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
    })`gomod2nix --dir projects/libs/demo-lib`;
    await fsp.copyFile(
      path.join(tmp, "projects", "libs", "demo-lib", "gomod2nix.toml"),
      path.join(tmp, "gomod2nix.toml"),
    );

    // Use scaf to create a new test under pkg/**
    const testPath = path.join(tmp, "projects/libs/demo-lib/pkg/demo-lib/extra_case_test.go");
    await $`scaf new go test extra_case --path=${testPath}`;

    // Glue and test
    await $`viberoots/build-tools/tools/dev/install-deps.ts --glue-only`;
    // Run tests; platform is set by runInTemp's .buckconfig
    await $`buck2 test //projects/libs/demo-lib:demo-lib_test --target-platforms //:no_cgo`;
  });
});
