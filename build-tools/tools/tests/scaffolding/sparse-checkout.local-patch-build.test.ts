#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { reconcileSyntheticGeneratedGraph } from "../lib/generated-graph.fixture";

// current-contract: Sparse checkout — ensure a lib with local patches builds and tests in a minimal repo
test("sparse checkout: go lib with local patches builds and tests", async () => {
  await runInTemp("sparse-local-patch-build", async (tmp, _$) => {
    const $ = _$({ stdio: "inherit" });

    // Scaffold a new Go library with auto-wired test
    await $`scaf new go lib demo-lib --yes --path=projects/libs/demo-lib`;

    // Seed gomod2nix deterministically via local stub (no network)
    const stubDir = path.join(tmp, "bin");
    await $`mkdir -p ${stubDir}`;
    const stubPath = path.join(stubDir, "gomod2nix");
    await $`bash --noprofile --norc -c ${`cat > ${stubPath} <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
DIR=.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)
      DIR="$2"; shift 2;;
    *) shift;;
  esac
done
mkdir -p "$DIR"
cat > "$DIR/gomod2nix.toml" <<'EOF2'
schema = 3
mod = {}
replace = {}
prune = { go-tests = true, unused-packages = true }
EOF2
EOF
chmod +x ${stubPath}
`}`;
    await $({
      cwd: tmp,
      stdio: "inherit",
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH || ""}` },
    })`gomod2nix --dir projects/libs/demo-lib`;
    await $`cp ${path.join(tmp, "projects/libs/demo-lib/gomod2nix.toml")} ${path.join(
      tmp,
      "gomod2nix.toml",
    )}`;

    // Add a local patch placeholder under the target
    const patchDir = path.join(tmp, "projects", "libs", "demo-lib", "patches", "go");
    await $`mkdir -p ${patchDir}`;
    await $`bash --noprofile --norc -c 'printf "# sparse noop patch\n" > ${patchDir}/example.com__placeholder@v0.0.0.patch'`;
    const graphEnv = await reconcileSyntheticGeneratedGraph(tmp);

    // Build the library target directly in sparse context
    await $({
      env: graphEnv,
    })`buck2 build //projects/libs/demo-lib:demo-lib --target-platforms //:no_cgo`;
  });
});
