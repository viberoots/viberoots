#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test(
  "scaf go test: app auto-wires *_test.go under cmd/<app>/**",
  { timeout: 240_000 },
  async () => {
    await runInTemp("scaf-test-app", async (tmp, _$) => {
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

      // Use scaf to create a new test under cmd/<app>/**
      const testPath = path.join(tmp, "apps/demo-cli/cmd/demo-cli/extra_case_test.go");
      await $`scaf new go test extra_case --path=${testPath}`;

      // Glue and test
      await $`tools/dev/install-deps.ts --glue-only`;
      // Run tests; platform is set by runInTemp's .buckconfig
      await $`buck2 test //apps/demo-cli:demo-cli_test --target-platforms //:no_cgo`;
    });
  },
);
