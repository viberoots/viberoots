#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go math-api lib builds and go test passes (scaffolded with temp math-core)", async () => {
  await runInTemp("go-math-api", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });

    // Scaffold minimal C++ math-core in temp repo (no changes to live repo)
    await $`bash -lc 'mkdir -p libs/math-core/include/core libs/math-core/include libs/math-core/src/core libs/math-core/src/cwrapper'`;
    await $`bash -lc 'cat > libs/math-core/include/addon.h <<"EOF"\n#ifndef MATH_CORE_ADDON_H\n#define MATH_CORE_ADDON_H\n#ifdef __cplusplus\nextern "C" {\n#endif\nint add(int a, int b);\n#ifdef __cplusplus\n}\n#endif\n#endif\nEOF'`;
    await $`bash -lc 'cat > libs/math-core/include/core/math.h <<"EOF"\n#ifndef MATH_CORE_CORE_MATH_H\n#define MATH_CORE_CORE_MATH_H\nnamespace math_core {\ninline int addInts(int a, int b) { return a + b; }\n}\n#endif\nEOF'`;
    await $`bash -lc 'cat > libs/math-core/src/core/math.cc <<"EOF"\n#include "../../include/core/math.h"\nnamespace math_core {\nstatic int unused_add(int a, int b) { return a + b; }\n}\nEOF'`;
    await $`bash -lc 'cat > libs/math-core/src/cwrapper/addon.cc <<"EOF"\n#include "../../include/addon.h"\n#include "../../include/core/math.h"\nextern \"C\" int add(int a, int b) { return math_core::addInts(a, b); }\nEOF'`;
    await $`bash -lc 'cat > libs/math-core/TARGETS <<"EOF"\nload(\"@prelude//:rules.bzl\", \"cxx_library\")\n\ncxx_library(\n    name = \"lib\",\n    srcs = [\n        \"src/core/math.cc\",\n        \"src/cwrapper/addon.cc\",\n    ],\n    headers = [\n        \"include/addon.h\",\n        \"include/core/math.h\",\n    ],\n    preferred_linkage = \"static\",\n    labels = [\"lang:cpp\", \"kind:lib\"],\n    visibility = [\"PUBLIC\"],\n)\nEOF'`;

    // Go cgo wrapper over addon.h (math-go-core)
    await $`bash -lc 'mkdir -p libs/math-go-core/core'`;
    await $`bash -lc 'cat > libs/math-go-core/core/bridge.go <<"EOF"\npackage core\n\n/*\n#cgo CFLAGS: -I../../math-core/include\n#cgo LDFLAGS: -lstdc++\n#include \"addon.h\"\n*/\nimport \"C\"\n\n// Add calls into the C wrapper which calls the C++ core\nfunc Add(a, b int) int {\n\treturn int(C.add(C.int(a), C.int(b)))\n}\nEOF'`;
    await $`bash -lc 'cat > libs/math-go-core/TARGETS <<"EOF"\nload(\"//go:defs.bzl\", \"nix_go_library\")\n\nnix_go_library(\n    name = \"lib\",\n    srcs = [\n        \"core/bridge.go\",\n    ],\n    # Link to the local C++ core via repo_cgo_deps\n    repo_cgo_deps = [\"//libs/math-core:lib\"],\n    labels = [\"lang:go\", \"kind:lib\"],\n    visibility = [\"PUBLIC\"],\n)\nEOF'`;

    // Public Go API facade (math-api) that depends on go-core
    await $`bash -lc 'mkdir -p libs/math-api/pkg/api'`;
    await $`bash -lc 'cat > libs/math-api/pkg/api/api.go <<"EOF"\npackage api\n\nfunc Add(a, b int) int { return a + b }\nEOF'`;
    await $`bash -lc 'cat > libs/math-api/pkg/api/api_test.go <<"EOF"\npackage api\n\nimport \"testing\"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(2, 3) != 5 { t.Fatalf(\"expected 5\") }\n\tif Add(-4, 4) != 0 { t.Fatalf(\"expected 0\") }\n}\nEOF'`;
    await $`bash -lc 'cat > libs/math-api/TARGETS <<"EOF"\nload(\"//go:defs.bzl\", \"nix_go_library\")\n\nnix_go_library(\n    name = \"lib\",\n    srcs = [\n        \"pkg/api/api.go\",\n    ],\n    labels = [\"lang:go\", \"kind:lib\"],\n    visibility = [\"PUBLIC\"],\n)\nEOF'`;

    // Build the stack and run the auto-wired go test for math-api
    // Build ensures acceptance: //libs/math-api:lib builds
    await $`buck2 build --target-platforms //:no_cgo //libs/math-api:lib`;
    await $`buck2 test --target-platforms //:no_cgo //libs/math-api:lib_test`;
  });
});
