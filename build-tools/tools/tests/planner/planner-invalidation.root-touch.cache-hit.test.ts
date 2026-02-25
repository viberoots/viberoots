#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// base-contract invalidation test: touching a non-app/lib file at repo root should NOT
// change the app binary derivation (cache hit expected; store path unchanged).

test("planner: touching root-only file does not change app bin store path", async () => {
  await runInTemp("planner-invalidation-root-touch", async (tmp, $) => {
    // Scaffold a small CLI app under apps/
    await $`scaf new go cli demo-cli --yes --path=projects/apps/demo-cli`;
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
    })`gomod2nix --dir projects/apps/demo-cli`;
    // Use app-local gomod2nix.toml (nearest ancestor resolution) to avoid broad root invalidations

    // Generate glue, then build graph-generator bundle
    await $`build-tools/tools/dev/install-deps.ts --glue-only`;
    const t1 = Date.now();
    const { stdout: outStd1 } = await $({
      cwd: tmp,
      stdio: "pipe",
    })`nix build --impure -L ${`path:${tmp}#graph-generator`} --accept-flake-config --no-link --print-out-paths`;
    const outPath1 =
      String(outStd1 || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop() || "";
    if (process.env.TEST_TIMING === "1")
      console.error(`[timing] first nix build: ${((Date.now() - t1) / 1000).toFixed(2)}s`);

    // Read manifest and ensure demo-cli entry exists with at least one bin
    const manifest1Path = path.join(outPath1, "manifest.json");
    const manifest1Txt = await fsp.readFile(manifest1Path, "utf8");
    const manifest1 = JSON.parse(manifest1Txt) as Array<any>;
    const entry1 = manifest1.find((e) =>
      String(e?.label || "").includes("projects/apps/demo-cli:demo-cli"),
    );
    if (!entry1 || !Array.isArray(entry1?.bins) || entry1.bins.length === 0) {
      throw new Error("missing demo-cli bin in manifest after first build");
    }
    const normalized1 = manifest1Txt.replace(
      /\/nix\/store\/[a-z0-9]{32,}-[^\"]+/g,
      "/nix/store/STOREHASH-BIN",
    );

    // Touch a root-only file that should be excluded by filtered src
    const sentinel = path.join(tmp, "ROOT_ONLY_SENTINEL.txt");
    await fsp.writeFile(sentinel, "root-only-change\n", "utf8");

    // Rebuild and compare the demo-cli bin store path
    const t2 = Date.now();
    const { stdout: outStd2 } = await $({
      cwd: tmp,
      stdio: "pipe",
    })`nix build --impure -L ${`path:${tmp}#graph-generator`} --accept-flake-config --no-link --print-out-paths`;
    const outPath2 =
      String(outStd2 || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop() || "";
    if (process.env.TEST_TIMING === "1")
      console.error(`[timing] second nix build: ${((Date.now() - t2) / 1000).toFixed(2)}s`);
    const manifest2Path = path.join(outPath2, "manifest.json");
    const manifest2Txt = await fsp.readFile(manifest2Path, "utf8");
    const manifest2 = JSON.parse(manifest2Txt) as Array<any>;
    const entry2 = manifest2.find((e) =>
      String(e?.label || "").includes("projects/apps/demo-cli:demo-cli"),
    );
    if (!entry2 || !Array.isArray(entry2?.bins) || entry2.bins.length === 0) {
      throw new Error("missing demo-cli bin in manifest after second build");
    }
    const normalized2 = manifest2Txt.replace(
      /\/nix\/store\/[a-z0-9]{32,}-[^\"]+/g,
      "/nix/store/STOREHASH-BIN",
    );

    if (normalized1 !== normalized2) {
      console.error(
        "expected normalized manifest to remain unchanged after touching root-only file",
      );
      console.error("manifest before (normalized):", normalized1);
      console.error("manifest after  (normalized):", normalized2);
      process.exit(2);
    }
  });
});
