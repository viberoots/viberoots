#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("package-local-wiring-probe", async (tmp, $) => {
  const pkg = path.join(tmp, "projects", "libs", "demo");
  await fsp.mkdir(path.join(pkg, "patches", "go"), { recursive: true });
  await fsp.writeFile(path.join(pkg, "patches", "go", "a@1.0.0.patch"), "# a\n", "utf8");

  await fsp.writeFile(
    path.join(pkg, "TARGETS"),
    [
      'load("//build-tools/lang/internal:package_local_wiring.bzl", "package_local_wiring_probe")',
      "",
      "package_local_wiring_probe(",
      '  name = "probe",',
      '  lang = "go",',
      '  kind = "lib",',
      '  base_deps = [":dep_a", "//third_party/providers:prov"],',
      '  providers = ["//third_party/providers:prov", "//third_party/providers:prov"],',
      '  nixpkg_deps = ["zlib"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );

  // Provide the provider target referenced by base_deps/providers.
  await $({
    cwd: tmp,
  })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;

  const so = await $({
    cwd: tmp,
    stdio: "pipe",
  })`buck2 build --target-platforms //:no_cgo --show-output //projects/libs/demo:probe`.nothrow();
  assert.equal(so.exitCode, 0, "buck2 build --show-output failed for probe");
  const outLine = String(so.stdout || "").trim();
  const outPath = outLine.split(/\s+/).pop()!;
  const absOutPath = path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath);
  const contents = await fsp.readFile(absOutPath, "utf8");
  const lines = contents
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const deps = lines.filter((l) => l.startsWith("dep:")).map((l) => l.slice("dep:".length));
  const labels = lines.filter((l) => l.startsWith("label:")).map((l) => l.slice("label:".length));
  const srcs = lines.filter((l) => l.startsWith("src:")).map((l) => l.slice("src:".length));

  assert.ok(labels.includes("lang:go"), "expected lang:go label");
  assert.ok(labels.includes("kind:lib"), "expected kind:lib label");
  assert.ok(labels.includes("nixpkg:pkgs.zlib"), "expected normalized nixpkg:pkgs.zlib label");

  assert.ok(srcs.includes("patches/go/a@1.0.0.patch"), "expected package-local patch file in srcs");

  // base_deps order is preserved, and provider deduplication is deterministic.
  assert.deepEqual(deps, [":dep_a", "//third_party/providers:prov"]);
});
