#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
// Ensure dev shell tools (gomod2nix, zx deps) are exported into temp repos
process.env.TEST_NEED_DEV_ENV = "1";

// base-contract closure test: ensure that content written to a root-only file does not
// appear anywhere under the materialized graph outputs, as a proxy that the
// filtered srcRoot (apps/libs only) excludes root files from the closure.

test("planner: root-only files are excluded from materialized outputs", async () => {
  await runInTemp("planner-closure-excludes-root", async (tmp, $) => {
    // Create a unique sentinel at repo root
    const sentinelTxt = `SENTINEL-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fsp.writeFile(path.join(tmp, "ONLY_AT_REPO_ROOT.txt"), sentinelTxt + "\n", "utf8");

    // Scaffold a small CLI app under apps/
    await $`scaf new go cli demo-cli --yes --path=projects/apps/demo-cli`;
    // Provide a local stub gomod2nix to avoid network and nix lookups for this no-deps app
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
    // No explicit go.sum creation here; allow glue-only to handle tidy deterministically.

    // Full path: glue-only (fail-fast gomod2nix), then export graph
    await $({
      env: {
        ...process.env,
        GOPROXY: "off",
        GOSUMDB: "off",
      },
    })`build-tools/tools/dev/install-deps.ts --glue-only`;
    await $`node build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    const { stdout } = await $({
      cwd: tmp,
      stdio: "pipe",
      env: { ...process.env, BUCK_TARGET: "//projects/apps/demo-cli:demo-cli" },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --no-link --accept-flake-config --print-out-paths`;
    const outPath =
      String(stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop() || "";

    // Walk the outLink tree and ensure sentinel is absent from files
    const root = outPath;
    async function listFilesRec(dir: string): Promise<string[]> {
      const out: string[] = [];
      const stack: string[] = [dir];
      while (stack.length) {
        const cur = stack.pop()!;
        let names: string[] = [];
        try {
          names = await fsp.readdir(cur);
        } catch {
          continue;
        }
        for (const name of names) {
          const p = path.join(cur, name);
          try {
            const st = await fsp.stat(p);
            if (st.isDirectory()) stack.push(p);
            else if (st.isFile()) out.push(p);
          } catch {}
        }
      }
      return out;
    }
    const files = await listFilesRec(root);
    for (const f of files) {
      // Reasonable size cap to avoid reading large binaries; sentinel is small
      let ok = false;
      try {
        const buf = await fsp.readFile(f, "utf8");
        ok = !buf.includes(sentinelTxt);
      } catch {
        ok = true; // binary or unreadable; assume sentinel absent
      }
      if (!ok) {
        console.error("found sentinel content in materialized output:", f);
        process.exit(2);
      }
    }
  });
});
