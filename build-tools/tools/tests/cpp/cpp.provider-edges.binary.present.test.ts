#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import fs from "fs-extra";
import * as fsp from "node:fs/promises";
import path from "node:path";

test("cpp binary realizes provider edges from MODULE_PROVIDERS in deps()", async () => {
  await runInTemp("cpp-provider-edges-bin", async (tmp, $) => {
    // Minimal provider target
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "TARGETS"),
      'genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])\n',
      "utf8",
    );
    // Map the demo binary to the provider
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > .viberoots/workspace/providers/auto_map.bzl <<\'EOF'
MODULE_PROVIDERS = {
  "//projects/apps/demo:demo": ["//third_party/providers:prov"],
}
EOF'`;

    // Simple C++ binary using nix_cpp_binary
    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fs.mkdirp(appDir);
    await fs.outputFile(path.join(appDir, "main.cpp"), "int main(){return 0;}\n");
    await fs.outputFile(
      path.join(appDir, "TARGETS"),
      `load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_binary")

nix_cpp_binary(
    name = "demo",
    srcs = ["main.cpp"],
)
`,
    );

    // Introspect deps; provider edge should be present
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms prelude//platforms:default "deps(//projects/apps/demo:demo)" --json --output-attribute name`;
    if (probe.exitCode !== 0) {
      console.error("buck2 cquery failed; prelude or config missing");
      process.exit(2);
    }
    const out = String(probe.stdout || "");
    if (!out.includes("//third_party/providers:prov")) {
      console.error("expected provider edge present in deps() for nix_cpp_binary");
      process.exit(2);
    }
  });
});
