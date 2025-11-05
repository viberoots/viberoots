#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go lib: adding *_test.go auto-wires nix_go_test and runs", async () => {
  await runInTemp("lib-auto-tests", async (tmp, _$) => {
    const $ = _$({ stdio: "inherit" });
    // ensure git repo for glue scripts that use git
    await $`git init`;

    // Scaffold a Go library
    await $`scaf new go lib demo-lib --yes --path=libs/demo-lib`;
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
    })`gomod2nix --dir libs/demo-lib`;
    await fsp.copyFile(
      path.join(tmp, "libs", "demo-lib", "gomod2nix.toml"),
      path.join(tmp, "gomod2nix.toml"),
    );

    // Add a simple *_test.go inside pkg/** so nix_go_library's auto-test picks it up
    const pkgDir = path.join(tmp, "libs/demo-lib/pkg/demo-lib");
    await fsp.mkdir(pkgDir, { recursive: true });
    await fsp.writeFile(
      path.join(pkgDir, "demo-lib_test.go"),
      'package demopkg\nimport "testing"\nfunc TestIt(t *testing.T){}\n',
      "utf8",
    );

    // Glue and build prerequisites
    await $`tools/dev/install-deps.ts --glue-only`;

    // Run the test via Buck; platform is set by runInTemp's .buckconfig
    await $`buck2 test //libs/demo-lib:demo-lib_test --target-platforms //:no_cgo`;
  });
});
