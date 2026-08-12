import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { artifactNixIndependentPolicyArgs } from "../../lib/artifact-nix-policy";
import { exportGraphInTemp } from "../lib/test-helpers";
import { commandEnv } from "../viberoots/remote-consumer-boundary";
import {
  buildCanonicalBundle,
  buildCanonicalBundleOutputs,
} from "./rust.source-selection.identity-bundle";
import { itoaChecksum, itoaSource, itoaVersion } from "./rust-wasm-acceptance-fixture";
import type { WasmAcceptanceContext } from "./rust-wasm-acceptance-cache-patch";
import { executeStaticDependencyConsumer } from "./rust-wasm-cross-language-runtime";

type Materialization = {
  sourceRevision: string;
  compositionDigest: string;
  sourceIdentity: {
    cargoLock: { path: string; sha256: string };
    patches: string[];
    sourceBundle: string;
  };
};

async function readMaterializations(outputs: string[]): Promise<Materialization[]> {
  return await Promise.all(
    outputs.map(async (output) =>
      JSON.parse(
        await fs.readFile(
          path.join(output, "share/viberoots-rust/materialization-manifest.json"),
          "utf8",
        ),
      ),
    ),
  );
}

export async function verifyPatchLifecycle(
  context: WasmAcceptanceContext,
  nix: string,
): Promise<void> {
  const {
    tmp,
    command: $,
    root,
    outputs,
    provenanceOutputs,
    currentInput,
    artifactToolsRoot,
  } = context;
  const reviewedNixPolicy = artifactNixIndependentPolicyArgs("reviewed");
  const emptyNixPolicy = artifactNixIndependentPolicyArgs("empty");
  const expression = `let f = builtins.getFlake ${JSON.stringify(
    `path:${currentInput}`,
  )}; pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem}; in pkgs.rustPlatform.importCargoLock { lockFile = ${JSON.stringify(
    path.join(root, "Cargo.lock"),
  )}; }`;
  const imported =
    await $`${nix} ${reviewedNixPolicy} build --impure --out-link ${path.join(tmp, "itoa-vendor-root")} --print-out-paths --expr ${expression}`;
  const vendorRoot = String(imported.stdout).trim();
  const dependency = (await fs.readdir(vendorRoot)).find((entry) =>
    entry.startsWith(`itoa-${itoaVersion}`),
  );
  assert.ok(dependency);
  const storePath = path.join(vendorRoot, dependency);
  const hash = String(
    await $`${nix} ${emptyNixPolicy} hash path --type sha256 --sri ${storePath}`,
  ).trim();
  const authority = { source: itoaSource, checksum: itoaChecksum, storePath, narHash: hash };
  const patchEnv = {
    ...commandEnv(tmp),
    WORKSPACE_ROOT: tmp,
    VIBEROOTS_FLAKE_INPUT_ROOT: currentInput,
    VIBEROOTS_ROOT: currentInput,
    VIBEROOTS_SOURCE_ROOT: currentInput,
    NIX_RUST_DEV_OVERRIDE_JSON: "{}",
    NIX_RUST_TEST_RESOLVE_JSON: JSON.stringify({
      [`itoa@${itoaVersion}#${itoaSource}`]: {
        originPath: storePath,
        ...authority,
        buildInput: authority,
      },
    }),
  };
  const cli = path.join(currentInput, "build-tools/tools/bin/patch-pkg");
  const target = "//projects/apps/rust-wasm:raw";
  await $({ env: patchEnv })`${cli} start rust itoa --target ${target}`;
  const sessions = JSON.parse(await fs.readFile(path.join(tmp, ".patch-sessions.json"), "utf8"));
  const workspace = sessions.sessions.rust[`itoa@${itoaVersion}#${itoaSource}`].workspacePath;
  await fs.writeFile(
    path.join(workspace, "src/lib.rs"),
    [
      "pub struct Buffer { text: String }",
      'impl Buffer { pub fn new() -> Self { Self { text: String::new() } } pub fn format<I>(&mut self, _: I) -> &str { self.text = "43".into(); &self.text } }',
      "",
    ].join("\n"),
  );
  await $({ env: patchEnv })`${cli} apply rust itoa --target ${target}`;
  await exportGraphInTemp({ tmp, $ });
  const names = ["browser", "component", "raw", "static"];
  if (!context.allowMissingWasiToolchain) {
    names.push("wasi_static", "wasi_component", "wasi_demo");
  }
  const buildFamily = async (): Promise<{ outputs: string[]; provenanceOutputs: string[] }> => {
    const family = { outputs: [] as string[], provenanceOutputs: [] as string[] };
    for (const name of names) {
      const built = await buildCanonicalBundleOutputs(
        tmp,
        "graph-generator-selected",
        currentInput,
        process.env,
        `//projects/apps/rust-wasm:${name}`,
        artifactToolsRoot,
        true,
        ["out", "provenance"],
      );
      family.outputs.push(built.out.outPath);
      family.provenanceOutputs.push(built.provenance.outPath);
    }
    return family;
  };
  const baselineManifests = await readMaterializations(provenanceOutputs);
  const { outputs: patched, provenanceOutputs: patchedProvenance } = await buildFamily();
  assert.ok(patched.every((output, index) => output !== outputs[index]));
  await assertPatchedFamily(context, names, patched, patchedProvenance);
  const patchedManifests = await readMaterializations(patchedProvenance);
  const lockedSourceIdentity = {
    cargoLockSha256: patchedManifests[0]!.sourceIdentity.cargoLock.sha256,
    patches: patchedManifests[0]!.sourceIdentity.patches,
  };
  assert.ok(
    patchedManifests.every(
      (manifest) =>
        JSON.stringify({
          cargoLockSha256: manifest.sourceIdentity.cargoLock.sha256,
          patches: manifest.sourceIdentity.patches,
        }) === JSON.stringify(lockedSourceIdentity),
    ),
  );
  assert.ok(
    patchedManifests.every(
      (manifest, index) =>
        manifest.sourceRevision !== baselineManifests[index]!.sourceRevision &&
        manifest.compositionDigest === baselineManifests[index]!.compositionDigest &&
        manifest.sourceIdentity.patches.length === 1,
    ),
  );
  await $({ env: patchEnv })`${cli} start rust itoa --target ${target}`;
  await $({ env: patchEnv })`${cli} remove rust itoa --target ${target}`;
  await exportGraphInTemp({ tmp, $ });
  const restored = await buildFamily();
  assert.deepEqual(restored.outputs, outputs);
  assert.deepEqual(restored.provenanceOutputs, provenanceOutputs);
  assert.deepEqual(await readMaterializations(provenanceOutputs), baselineManifests);
  await assert.rejects(fs.access(path.join(root, "patches")), /ENOENT/);
  await verifySourceMutationLineage(context, baselineManifests[2]!);
}

async function assertPatchedFamily(
  context: WasmAcceptanceContext,
  names: string[],
  outputs: string[],
  provenanceOutputs: string[],
): Promise<void> {
  const { tmp, command: $, currentInput, artifactToolsRoot } = context;
  const raw = await WebAssembly.instantiate(
    await fs.readFile(path.join(outputs[names.indexOf("raw")]!, "lib/rust_wasm_fixture.wasm")),
  );
  assert.equal((raw.instance.exports.dependency_answer as () => number)(), 43);
  const browserRoot = path.join(outputs[names.indexOf("browser")]!, "pkg");
  const browser = await import(
    `${pathToFileURL(path.join(browserRoot, "rust_wasm_fixture.js")).href}?patched=1`
  );
  await browser.default(await fs.readFile(path.join(browserRoot, "rust_wasm_fixture_bg.wasm")));
  assert.equal(browser.dependency_answer(), 43);
  for (const name of [
    "component",
    ...(names.includes("wasi_component") ? ["wasi_component"] : []),
  ]) {
    const output = outputs[names.indexOf(name)]!;
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(
          provenanceOutputs[names.indexOf(name)]!,
          "share/viberoots-rust/wasm-manifest.json",
        ),
        "utf8",
      ),
    );
    const result =
      await $`${path.join(manifest.tools.wasmtime, "bin/wasmtime")} run --invoke ${"dependency-answer()"} ${path.join(output, "lib/rust_wasm_fixture.component.wasm")}`;
    assert.equal(String(result).trim(), "43");
  }
  assert.equal(
    await executeStaticDependencyConsumer(tmp, currentInput, artifactToolsRoot, false),
    43,
  );
  if (names.includes("wasi_static")) {
    assert.equal(
      await executeStaticDependencyConsumer(tmp, currentInput, artifactToolsRoot, true),
      43,
    );
    const demo = outputs[names.indexOf("wasi_demo")]!;
    const result = await $({ env: commandEnv(tmp) })`${path.join(demo, "bin/wasi_demo")}`;
    assert.match(String(result.stdout), /wasi-rust-43/);
  }
}

async function verifySourceMutationLineage(
  context: WasmAcceptanceContext,
  baseline: Materialization,
): Promise<void> {
  const source = path.join(context.root, "src/lib.rs");
  const original = await fs.readFile(source);
  try {
    await fs.appendFile(source, "// source lineage mutation\n");
    await exportGraphInTemp({ tmp: context.tmp, $: context.command });
    const mutated = await buildCanonicalBundle(
      context.tmp,
      "graph-generator-selected",
      context.currentInput,
      process.env,
      "//projects/apps/rust-wasm:raw",
      context.artifactToolsRoot,
      true,
      "provenance",
    );
    const manifest = (await readMaterializations([mutated.outPath]))[0]!;
    assert.notEqual(manifest.sourceRevision, baseline.sourceRevision);
    assert.equal(manifest.compositionDigest, baseline.compositionDigest);
  } finally {
    await fs.writeFile(source, original);
    await exportGraphInTemp({ tmp: context.tmp, $: context.command });
  }
  const restored = await buildCanonicalBundle(
    context.tmp,
    "graph-generator-selected",
    context.currentInput,
    process.env,
    "//projects/apps/rust-wasm:raw",
    context.artifactToolsRoot,
    true,
    "provenance",
  );
  assert.equal(restored.outPath, context.provenanceOutputs[2]);
  assert.deepEqual((await readMaterializations([restored.outPath]))[0], baseline);
}
