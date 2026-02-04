#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import fs from "fs-extra";
import path from "node:path";

test("cpp library realizes provider edges from MODULE_PROVIDERS in deps()", async () => {
  await runInTemp("cpp-provider-edges-lib", async (tmp, $) => {
    // Minimal provider target
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<\'EOF'
genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;
    // Map the demo library to the provider
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > third_party/providers/auto_map.bzl <<\'EOF'
MODULE_PROVIDERS = {
  "//libs/demo:lib": ["//third_party/providers:prov"],
}
EOF'`;

    // Simple C++ library using nix_cpp_library
    const libDir = path.join(tmp, "libs/demo");
    await fs.mkdirp(libDir);
    await fs.outputFile(path.join(libDir, "lib.cpp"), "int add(int a,int b){return a+b;}\n");
    await fs.outputFile(
      path.join(libDir, "TARGETS"),
      `load("//build-tools/cpp:defs.bzl", "nix_cpp_library")

nix_cpp_library(
    name = "lib",
    srcs = ["lib.cpp"],
)
`,
    );

    // Introspect deps; provider edge should be present
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms prelude//platforms:default "deps(//libs/demo:lib)" --json --output-attribute name`;
    if (probe.exitCode !== 0) {
      console.error("buck2 cquery failed; prelude or config missing");
      process.exit(2);
    }
    const out = String(probe.stdout || "");
    if (!out.includes("//third_party/providers:prov")) {
      console.error("expected provider edge present in deps() for nix_cpp_library");
      process.exit(2);
    }
  });
});
