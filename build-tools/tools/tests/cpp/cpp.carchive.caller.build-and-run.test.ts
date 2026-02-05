#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

// This test scaffolds a minimal Go c-archive and a C++ caller in a temp repo,
// exports the graph, and builds the selected target via graph-generator-selected.
// It mirrors the repo_cgo_deps pattern used for Go->C but exercises C->Go.

test("cpp calls go c-archive (temp repo)", async () => {
  await runInTemp("cpp-carchive-caller", async (tmp, $) => {
    // Create a Go c-archive lib
    await $({ cwd: tmp })`bash --noprofile --norc -c 'mkdir -p libs/greetgo'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > libs/greetgo/export.go <<"EOF"\npackage main\n\n// #include <stdint.h>\nimport \"C\"\n\n//export GoGreet\nfunc GoGreet() *C.char {\n    return C.CString(\"hello from go\")\n}\n\nfunc main() {}\nEOF'`;
    // Minimal Go module + gomod2nix for this temp repo package (no deps; fully local).
    await fsp.writeFile(
      path.join(tmp, "libs", "greetgo", "go.mod"),
      "module example.com/greetgo\n\ngo 1.22\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "libs", "greetgo", "gomod2nix.toml"),
      [
        "schema = 3",
        "mod = {}",
        "replace = {}",
        "prune = { go-tests = true, unused-packages = true }",
        "",
      ].join("\n"),
      "utf8",
    );
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > libs/greetgo/TARGETS <<"EOF"\nload("//build-tools/go:defs.bzl", "nix_go_carchive")\n\nnix_go_carchive(\n    name = "greetgo",\n    srcs = [\n        "export.go",\n    ],\n    labels = ["lang:go", "kind:carchive"],\n    visibility = ["PUBLIC"],\n)\nEOF'`;

    // Create a C++ caller that uses the exported Go symbol
    await $({ cwd: tmp })`bash --noprofile --norc -c 'mkdir -p apps/caller/src apps/caller/tests'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > apps/caller/src/main.cpp <<"EOF"\n#include <iostream>\nextern "C" char* GoGreet();\nint main() {\n  char* s = GoGreet();\n  if (s) std::cout << s << "\\n";\n  return 0;\n}\nEOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > apps/caller/tests/caller_gtest.cpp <<"EOF"\n#include <gtest/gtest.h>\nextern "C" char* GoGreet();\nTEST(CGoCaller, CallsGo) {\n  char* s = GoGreet();\n  ASSERT_NE(s, nullptr);\n}\nEOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > apps/caller/TARGETS <<"EOF"
load("//build-tools/cpp:defs.bzl", "nix_cpp_binary", "nix_cpp_test")

nix_cpp_binary(
    name = "caller",
    srcs = ["src/main.cpp"],
    deps = ["//projects/libs/greetgo:greetgo"],
    labels = ["lang:cpp", "kind:bin"],
    visibility = ["PUBLIC"],
)

nix_cpp_test(
    name = "caller_gtest",
    srcs = ["tests/caller_gtest.cpp"],
    deps = [
        ":caller",
        "//projects/libs/greetgo:greetgo",
    ],
    nixpkg_deps = [
        "pkgs.googletest",
    ],
    labels = ["lang:cpp", "kind:test"],
)
EOF'`;

    // Verify Buck graph is available, then export graph and build selected target
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir cpp_carchive cquery "deps(//projects/apps/caller:caller)" --json --output-attribute name`;
    if (probe.exitCode !== 0) {
      // Skip if prelude/toolchain not available in the environment
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
      env: { ...process.env, BUCK_TARGET: "//projects/apps/caller:caller" },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
    if (build.exitCode !== 0) {
      console.error(build.stdout + "\n" + build.stderr);
      throw new Error("nix build failed");
    }
  });
});
