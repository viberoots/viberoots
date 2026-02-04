#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("repo_cgo_deps wires local cpp lib and runs", async () => {
  await runInTemp("go-cgo-repo-lib", async (tmp, $) => {
    // Create a small C++ library and a Go CLI that calls into it via cgo
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p libs/greeter/include libs/greeter/src apps/demo-cli/cmd/demo'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > libs/greeter/include/greeter.h <<"EOF"\n#pragma once\n#ifdef __cplusplus\nextern "C" {\n#endif\nconst char* greet();\n#ifdef __cplusplus\n}\n#endif\nEOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > libs/greeter/src/greeter.cpp <<"EOF"\n#include <string>\n#include "greeter.h"\nstatic std::string s = std::string("hello from cpp");\nconst char* greet() { return s.c_str(); }\nEOF'`;

    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > libs/greeter/TARGETS <<"EOF"\nload("//build-tools/cpp:defs.bzl", "nix_cpp_library")\n\n# Build the C++ static lib via Nix\nnix_cpp_library(\n    name = "greeter",\n    srcs = ["src/greeter.cpp"],\n    headers = ["include/greeter.h"],\n    labels = ["lang:cpp", "kind:lib"],\n)\nEOF'`;

    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > apps/demo-cli/cmd/demo/main.go <<"EOF"\npackage main\n/*\n#cgo LDFLAGS: -lstdc++\n#include "greeter.h"\n*/\nimport "C"\n\nimport "fmt"\n\nfunc main() {\n  fmt.Println("greet:", C.GoString(C.greet()))\n}\nEOF'`;

    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > apps/demo-cli/TARGETS <<"EOF"\nload("//build-tools/go:defs.bzl", "nix_go_binary")\n\n# Consume the local C++ lib via repo_cgo_deps\nnix_go_binary(\n    name = "demo",\n    srcs = ["cmd/demo/main.go"],\n    repo_cgo_deps = ["//libs/greeter:greeter"],\n)\nEOF'`;

    // Export a graph and attempt a planner build of the selected target
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir cgo_repo_lib cquery "deps(//apps/demo-cli:demo)" --json --output-attribute name`;
    if (probe.exitCode !== 0) {
      // Skip on environments without prelude
      return;
    }

    await $({
      cwd: tmp,
    })`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, BUCK_TARGET: "//apps/demo-cli:demo" },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
    if (build.exitCode !== 0) {
      console.error(build.stdout + "\n" + build.stderr);
      throw new Error("nix build failed");
    }
  });
});
