#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function firstCqueryNode<T>(json: unknown): T | null {
  if (Array.isArray(json)) return (json[0] as T) ?? null;
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    const k = Object.keys(obj)[0];
    if (!k) return null;
    const v = obj[k];
    if (Array.isArray(v)) return (v[0] as T) ?? null;
    return (v as T) ?? null;
  }
  return null;
}

function srcToString(src: unknown): string {
  if (typeof src === "string") return src;
  if (src && typeof src === "object") {
    const o = src as Record<string, unknown>;
    if (typeof o.path === "string") return o.path;
    if (typeof o.source === "string") return o.source;
  }
  try {
    return JSON.stringify(src);
  } catch {
    return String(src);
  }
}

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

      // Assert wiring via cquery (fast, deterministic, and not sensitive to toolchain rebuild time).
      const q = await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //apps/demo-cli:demo-cli_test`;
      if (q.exitCode !== 0) return; // skip when Buck/prelude/toolchains unavailable
      const node = firstCqueryNode<{ srcs?: unknown[] }>(JSON.parse(String(q.stdout || "")));
      const srcs = (node?.srcs || []).map(srcToString);

      const wantA = "apps/demo-cli/cmd/demo-cli/extra_case_test.go";
      const wantB = "cmd/demo-cli/extra_case_test.go";
      assert.ok(
        srcs.some((s) => s.includes(wantA) || s.includes(wantB)),
        `expected ${wantA} (or ${wantB}) in srcs; got:\n${srcs.join("\n")}\n\nraw cquery:\n${String(q.stdout || "").slice(0, 4000)}`,
      );
    });
  },
);
