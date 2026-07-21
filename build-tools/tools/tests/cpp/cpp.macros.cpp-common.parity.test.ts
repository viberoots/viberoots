#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { normalizeTargetLabel } from "../../lib/labels";

type CqueryNode = {
  out?: string;
  kind?: string;
  self_label?: string;
  labels?: string[];
  deps?: string[];
  srcs?: string[];
  nix_inputs?: string[];
};

function normalizeBuckOutputAttributes(n: any): CqueryNode {
  // Newer buck2 versions emit attributes under "buck.<attr>" keys in JSON output.
  // Normalize by copying buck.* keys to their unprefixed form for stable test assertions.
  if (!n || typeof n !== "object") return n as CqueryNode;
  for (const [k, v] of Object.entries(n)) {
    if (!k.startsWith("buck.")) continue;
    const bare = k.slice("buck.".length);
    if (!(bare in n)) {
      (n as any)[bare] = v;
    }
  }
  return n as CqueryNode;
}

async function cqueryOne(
  tmp: string,
  $: any,
  target: string,
  attrs: string,
): Promise<CqueryNode | null> {
  const outputAttrFlags = attrs
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((a) => ["--output-attribute", a]);
  const probe = await $({
    cwd: tmp,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`buck2 cquery --target-platforms //:no_cgo --json ${outputAttrFlags} ${target}`;
  if (probe.exitCode !== 0) return null;
  const parsed = JSON.parse(String(probe.stdout || "")) as unknown;
  if (Array.isArray(parsed)) return (parsed[0] as CqueryNode) || null;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const k = Object.keys(obj)[0];
    if (!k) return null;
    const v = obj[k];
    if (Array.isArray(v)) return (v[0] as CqueryNode) || null;
    return normalizeBuckOutputAttributes(v as any);
  }
  return null;
}

function sanitizeValueFromProbeOut(out: string): string {
  assert.ok(out.endsWith(".txt"), `expected cpp_sanitize_probe out to end with .txt, got: ${out}`);
  return out.slice(0, -".txt".length);
}

test("cpp macros: lib/bin/addon delegate through shared core and keep emitted attrs consistent", async () => {
  await runInTemp("cpp-macros-cpp-common", async (tmp, $) => {
    // Provider target and mapping used by realize_provider_edges(...)
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "TARGETS"),
      [
        'genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])',
        'genrule(name="prov_extra", out="prov_extra.stamp", cmd=": > $OUT", visibility=["PUBLIC"])',
        "",
      ].join("\n"),
      "utf8",
    );
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > .viberoots/workspace/providers/auto_map.bzl <<'\''EOF'\''
MODULE_PROVIDERS = {
  "//projects/libs/demo:lib": ["//third_party/providers:prov"],
  "//projects/apps/demo:demo": ["//third_party/providers:prov"],
  "//projects/libs/addon:addon": ["//third_party/providers:prov"],
}
EOF'`;

    // Library package
    const libDir = path.join(tmp, "projects", "libs", "demo");
    await fsp.mkdir(path.join(libDir, "patches", "cpp"), { recursive: true });
    await fsp.writeFile(path.join(libDir, "patches", "cpp", "x@0.0.1.patch"), "# x\n", "utf8");
    await fsp.writeFile(
      path.join(libDir, "lib.cpp"),
      "int add(int a,int b){return a+b;}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(libDir, "TARGETS"),
      `load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library", "cpp_sanitize_probe")

genrule(name="localprov", out="localprov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])

cpp_sanitize_probe(
    name = "sanitize_lib",
    label = "//projects/libs/demo:lib",
)

nix_cpp_library(
    name = "lib",
    srcs = ["lib.cpp"],
    nixpkg_deps = ["zlib"],
    extra_module_providers = ["//third_party/providers:prov_extra", ":localprov"],
)
`,
      "utf8",
    );

    // Binary package
    const binDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(path.join(binDir, "patches", "cpp"), { recursive: true });
    await fsp.writeFile(path.join(binDir, "patches", "cpp", "y@2.3.4.patch"), "# y\n", "utf8");
    await fsp.writeFile(path.join(binDir, "main.cpp"), "int main(){return 0;}\n", "utf8");
    await fsp.writeFile(
      path.join(binDir, "TARGETS"),
      `load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_binary", "cpp_sanitize_probe")

genrule(name="localprov", out="localprov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])

cpp_sanitize_probe(
    name = "sanitize_bin",
    label = "//projects/apps/demo:demo",
)

nix_cpp_binary(
    name = "demo",
    srcs = ["main.cpp"],
    nixpkg_deps = ["pkgs.ZLIB"],
    extra_module_providers = ["//third_party/providers:prov_extra", ":localprov"],
)
`,
      "utf8",
    );

    // Addon package
    const addonDir = path.join(tmp, "projects", "libs", "addon");
    await fsp.mkdir(path.join(addonDir, "patches", "cpp"), { recursive: true });
    await fsp.writeFile(path.join(addonDir, "patches", "cpp", "z@9.9.9.patch"), "# z\n", "utf8");
    await fsp.writeFile(path.join(addonDir, "addon.cpp"), "int x(){return 1;}\n", "utf8");
    await fsp.writeFile(
      path.join(addonDir, "TARGETS"),
      `load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_node_addon", "cpp_sanitize_probe")

genrule(name="localprov", out="localprov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])

cpp_sanitize_probe(
    name = "sanitize_addon",
    label = "//projects/libs/addon:addon",
)

nix_cpp_node_addon(
    name = "addon",
    srcs = ["addon.cpp"],
    addon_name = "demo_addon",
    nixpkg_deps = ["pkgs.zlib"],
    extra_module_providers = ["//third_party/providers:prov_extra", ":localprov"],
)
`,
      "utf8",
    );

    const attrs = "out,kind,self_label,labels,deps,srcs,nix_inputs";

    const sLibProbe = await cqueryOne(tmp, $, "//projects/libs/demo:sanitize_lib", "out");
    const sBinProbe = await cqueryOne(tmp, $, "//projects/apps/demo:sanitize_bin", "out");
    const sAddonProbe = await cqueryOne(tmp, $, "//projects/libs/addon:sanitize_addon", "out");
    if (!sLibProbe || !sBinProbe || !sAddonProbe) return;

    const sLib = sanitizeValueFromProbeOut(String(sLibProbe.out));
    const sBin = sanitizeValueFromProbeOut(String(sBinProbe.out));
    const sAddon = sanitizeValueFromProbeOut(String(sAddonProbe.out));

    const lib = await cqueryOne(tmp, $, "//projects/libs/demo:lib", attrs);
    const bin = await cqueryOne(tmp, $, "//projects/apps/demo:demo", attrs);
    const addon = await cqueryOne(tmp, $, "//projects/libs/addon:addon", attrs);
    if (!lib || !bin || !addon) return;

    assert.equal(lib.kind, "lib");
    assert.equal(bin.kind, "bin");
    assert.equal(addon.kind, "addon");

    assert.equal(lib.self_label, "//projects/libs/demo:lib");
    assert.equal(bin.self_label, "//projects/apps/demo:demo");
    assert.equal(addon.self_label, "//projects/libs/addon:addon");

    assert.equal(lib.out, `${sLib}.a`);
    assert.equal(bin.out, sBin);
    assert.equal(addon.out, `${sAddon}.node`);

    const hasNixInputs = (n: CqueryNode) =>
      (n.nix_inputs || []).some((x) => String(x).includes("flake.lock"));
    assert.ok(hasNixInputs(lib), "expected flake.lock to be present in nix_inputs for lib");
    assert.ok(hasNixInputs(bin), "expected flake.lock to be present in nix_inputs for bin");
    assert.ok(hasNixInputs(addon), "expected flake.lock to be present in nix_inputs for addon");

    const expectsLabels = (n: CqueryNode, kind: string) => {
      const labels = n.labels || [];
      assert.ok(labels.includes("lang:cpp"), `expected lang:cpp label for ${kind}`);
      assert.ok(labels.includes(`kind:${kind}`), `expected kind:${kind} label`);
      assert.ok(labels.includes("nixpkg:pkgs.zlib"), "expected normalized nixpkg:pkgs.zlib label");
    };
    expectsLabels(lib, "lib");
    expectsLabels(bin, "bin");
    expectsLabels(addon, "addon");
    assert.ok(
      (addon.labels || []).includes("addon_name:demo_addon"),
      "expected addon_name label hint",
    );

    const expectsProviderEdge = (n: CqueryNode, label: string) => {
      const deps = (n.deps || []).map((d) => normalizeTargetLabel(String(d)));
      const want = normalizeTargetLabel("//third_party/providers:prov");
      const extra = normalizeTargetLabel("//third_party/providers:prov_extra");
      const local = normalizeTargetLabel(`${label.split(":")[0]}:localprov`);
      assert.ok(
        deps.includes(want),
        `expected provider dep realized for ${label}; want=${want}; have=${JSON.stringify(deps)}`,
      );
      assert.ok(
        deps.includes(extra),
        `expected extra_module_providers to be present for ${label}; want=${extra}; have=${JSON.stringify(deps)}`,
      );
      assert.ok(
        deps.includes(local),
        `expected normalized extra_module_providers relative label for ${label}; want=${local}; have=${JSON.stringify(deps)}`,
      );
    };
    expectsProviderEdge(lib, "//projects/libs/demo:lib");
    expectsProviderEdge(bin, "//projects/apps/demo:demo");
    expectsProviderEdge(addon, "//projects/libs/addon:addon");

    const expectsPatchInput = (n: CqueryNode, pkg: string) => {
      const srcs = n.srcs || [];
      assert.ok(
        srcs.some((s) => String(s).includes(`${pkg}/patches/cpp/`)),
        `expected package-local patches/cpp to be included in srcs for ${pkg}`,
      );
    };
    expectsPatchInput(lib, "libs/demo");
    expectsPatchInput(bin, "apps/demo");
    expectsPatchInput(addon, "libs/addon");
  });
});
