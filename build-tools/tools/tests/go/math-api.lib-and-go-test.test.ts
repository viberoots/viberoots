#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go math-api lib builds and go test passes (scaffolded with temp math-core)", async () => {
  await runInTemp("go-math-api", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });

    // Scaffold minimal C++ math-core in temp repo (no changes to live repo)
    await $`bash --noprofile --norc -c 'mkdir -p projects/libs/math-core/include/core projects/libs/math-core/include projects/libs/math-core/src/core projects/libs/math-core/src/cwrapper'`;
    await $`bash --noprofile --norc -c 'cat > projects/libs/math-core/include/addon.h <<"EOF"\n#ifndef MATH_CORE_ADDON_H\n#define MATH_CORE_ADDON_H\n#ifdef __cplusplus\nextern \"C\" {\n#endif\nint add(int a, int b);\n#ifdef __cplusplus\n}\n#endif\n#endif\nEOF'`;
    await $`bash --noprofile --norc -c 'cat > projects/libs/math-core/include/core/math.h <<"EOF"\n#ifndef MATH_CORE_CORE_MATH_H\n#define MATH_CORE_CORE_MATH_H\nnamespace math_core {\ninline int addInts(int a, int b) { return a + b; }\n}\n#endif\nEOF'`;
    await $`bash --noprofile --norc -c 'cat > projects/libs/math-core/src/core/math.cc <<"EOF"\n#include "../../include/core/math.h"\nnamespace math_core {\nstatic int unused_add(int a, int b) { return a + b; }\n}\nEOF'`;
    await $`bash --noprofile --norc -c 'cat > projects/libs/math-core/src/cwrapper/addon.cc <<"EOF"\n#include "../../include/addon.h"\n#include "../../include/core/math.h"\nextern \"C\" int add(int a, int b) { return math_core::addInts(a, b); }\nEOF'`;
    await $`bash --noprofile --norc -c 'cat > projects/libs/math-core/TARGETS <<"EOF"\nload(\"@prelude//:rules.bzl\", \"cxx_library\")\n\ncxx_library(\n    name = \"lib\",\n    srcs = [\n        \"src/core/math.cc\",\n        \"src/cwrapper/addon.cc\",\n    ],\n    headers = [\n        \"include/addon.h\",\n        \"include/core/math.h\",\n    ],\n    preferred_linkage = \"static\",\n    labels = [\"lang:cpp\", \"kind:lib\"],\n    visibility = [\"PUBLIC\"],\n)\nEOF'`;

    // Go cgo wrapper over addon.h (math-go-core)
    await $`bash --noprofile --norc -c 'mkdir -p projects/libs/math-go-core/core'`;
    await $`bash --noprofile --norc -c 'cat > projects/libs/math-go-core/core/bridge.go <<"EOF"\npackage core\n\n/*\n#cgo CFLAGS: -I../../math-core/include\n#cgo LDFLAGS: -lstdc++\n#include \"addon.h\"\n*/\nimport \"C\"\n\n// Add calls into the C wrapper which calls the C++ core\nfunc Add(a, b int) int {\n\treturn int(C.add(C.int(a), C.int(b)))\n}\nEOF'`;
    await $`bash --noprofile --norc -c 'cat > projects/libs/math-go-core/go.mod <<"EOF"\nmodule example.com/math-go-core\n\ngo 1.22\nEOF'`;
    await $`bash --noprofile --norc -c 'cat > projects/libs/math-go-core/TARGETS <<"EOF"\nload(\"@viberoots//build-tools/go:defs.bzl\", \"nix_go_library\")\n\nnix_go_library(\n    name = \"lib\",\n    srcs = [\n        \"core/bridge.go\",\n    ],\n    # Link to the local C++ core via repo_cgo_deps\n    repo_cgo_deps = [\"//projects/libs/math-core:lib\"],\n    labels = [\"lang:go\", \"kind:lib\"],\n    visibility = [\"PUBLIC\"],\n)\nEOF'`;

    // Public Go API facade (math-api) that depends on go-core
    await $`bash --noprofile --norc -c 'mkdir -p projects/libs/math-api/pkg/api'`;
    await $`bash --noprofile --norc -c 'cat > projects/libs/math-api/pkg/api/api.go <<"EOF"\npackage api\n\nfunc Add(a, b int) int { return a + b }\nEOF'`;
    await $`bash --noprofile --norc -c 'cat > projects/libs/math-api/pkg/api/api_test.go <<"EOF"\npackage api\n\nimport \"testing\"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(2, 3) != 5 { t.Fatalf(\"expected 5\") }\n\tif Add(-4, 4) != 0 { t.Fatalf(\"expected 0\") }\n}\nEOF'`;
    await $`bash --noprofile --norc -c 'cat > projects/libs/math-api/go.mod <<"EOF"\nmodule example.com/math-api\n\ngo 1.22\nEOF'`;
    await $`bash --noprofile --norc -c 'cat > projects/libs/math-api/TARGETS <<"EOF"\nload(\"@viberoots//build-tools/go:defs.bzl\", \"nix_go_library\")\n\nnix_go_library(\n    name = \"lib\",\n    srcs = [\n        \"pkg/api/api.go\",\n    ],\n    labels = [\"lang:go\", \"kind:lib\"],\n    visibility = [\"PUBLIC\"],\n)\nEOF'`;

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
    })`gomod2nix --dir projects/libs/math-api`;
    await $`cp ${path.join(tmp, "projects/libs/math-api/gomod2nix.toml")} ${path.join(
      tmp,
      "gomod2nix.toml",
    )}`;

    await $`viberoots/build-tools/tools/dev/install-deps.ts --glue-only`;

    // Build the stack and run the auto-wired go test for math-api
    // Build ensures acceptance: //projects/libs/math-api:lib builds
    await $`buck2 build --target-platforms //:no_cgo //projects/libs/math-api:lib`;
    await $`buck2 cquery --target-platforms //:no_cgo "kind(go_nix_test, //projects/libs/math-api:lib_test)"`;
    await $`buck2 test --target-platforms //:no_cgo //projects/libs/math-api:lib_test`;
  });
});
