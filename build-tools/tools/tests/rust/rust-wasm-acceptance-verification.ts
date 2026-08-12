import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { commandEnv } from "../viberoots/remote-consumer-boundary";
import { buildCanonicalBundle } from "./rust.source-selection.identity-bundle";

export type RuntimeClosureIdentity = {
  closureSize: number;
  references: string[];
};

function storePathLines(value: string, context: string): string[] {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.some((line) => !/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(line))) {
    throw new Error(`invalid nix-store ${context} evidence`);
  }
  return lines;
}

export function stableNixStoreQueryEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, NIX_CONFIG: "" };
}

export function parseNixStoreRuntimeIdentity(
  output: string,
  referencesOutput: string,
  requisitesOutput: string,
  sizesOutput: string,
): RuntimeClosureIdentity {
  const references = storePathLines(referencesOutput, "reference");
  const requisites = storePathLines(requisitesOutput, "requisite");
  if (!requisites.includes(output)) {
    throw new Error(`nix-store closure evidence omitted ${output}`);
  }
  const sizes = sizesOutput
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(Number);
  if (
    sizes.length !== requisites.length ||
    sizes.some((size) => !Number.isSafeInteger(size) || size < 0)
  ) {
    throw new Error(`invalid nix-store closure-size evidence for ${output}`);
  }
  const closureSize = sizes.reduce((total, size) => total + size, 0);
  if (!Number.isSafeInteger(closureSize)) {
    throw new Error(`nix-store closure-size evidence overflowed for ${output}`);
  }
  return { closureSize, references };
}

export async function verifyRuntimeReferenceBoundaries(
  tmp: string,
  command: any,
  outputs: string[],
  debugOutput: string,
  tools: string,
  allowMissingWasiToolchain: boolean,
): Promise<void> {
  const runtimeOutputs = [...outputs, debugOutput];
  const nixStore = path.join(tools, "bin/nix-store");
  const queryEnv = stableNixStoreQueryEnv(process.env);
  const identities: Record<string, RuntimeClosureIdentity> = {};
  for (const output of runtimeOutputs) {
    const references = await command({
      cwd: tmp,
      env: queryEnv,
      stdio: "pipe",
    })`${nixStore} --query --references ${output}`;
    const requisites = await command({
      cwd: tmp,
      env: queryEnv,
      stdio: "pipe",
    })`${nixStore} --query --requisites ${output}`;
    const requisitePaths = storePathLines(String(requisites.stdout), "requisite");
    const sizes = await command({
      cwd: tmp,
      env: queryEnv,
      stdio: "pipe",
    })`${nixStore} --query --size ${requisitePaths}`;
    identities[output] = parseNixStoreRuntimeIdentity(
      output,
      String(references.stdout),
      String(requisites.stdout),
      String(sizes.stdout),
    );
  }
  for (const output of runtimeOutputs) {
    const identity = identities[output]!;
    const name = path.basename(output);
    const expectedRunnerReference =
      !allowMissingWasiToolchain && output === outputs[6]
        ? (reference: string) => reference === output || /-(?:bash|nodejs)-?[^/]*$/u.test(reference)
        : () => false;
    assert.ok(
      identity.references.every(expectedRunnerReference),
      `${name} retained unexpected runtime references: ${identity.references.join(", ")}`,
    );
    console.log(
      `[rust-wasm-runtime-closure] output=${name} bytes=${identity.closureSize} refs=${identity.references.length}`,
    );
  }
  for (const output of [outputs[3], ...(!allowMissingWasiToolchain ? [outputs[4]] : [])]) {
    assert.ok(
      identities[output!]!.closureSize < 32 * 1024 * 1024,
      `${path.basename(output!)} static runtime closure exceeded 32 MiB`,
    );
  }
}

export async function verifyProfilesAndComponent(
  tmp: string,
  command: any,
  outputs: string[],
  provenanceOutputs: string[],
  debug: string,
  debugProvenance: string,
  component: string,
  current: string,
): Promise<void> {
  await fs.access(path.join(debug, "pkg/rust_wasm_fixture_bg.wasm.map"));
  const packageJson = JSON.parse(await fs.readFile(path.join(debug, "pkg/package.json"), "utf8"));
  assert.ok(packageJson.files.includes("rust_wasm_fixture_bg.wasm.map"));
  const debugManifest = await readWasmManifest(debugProvenance);
  assert.deepEqual(
    [debugManifest.optimize, debugManifest.debug, debugManifest.sourceMap],
    ["speed", true, true],
  );
  const manifest = await readWasmManifest(provenanceOutputs[1]!);
  assert.equal(
    String(
      await command`${path.join(manifest.tools.wasmtime, "bin/wasmtime")} run --invoke ${"add(2, 3)"} ${component}`,
    ).trim(),
    "5",
  );
  assert.equal(manifest.world, "calculator");
  assert.equal(manifest.adapter, "none");
  assert.match(
    await fs.readFile(path.join(outputs[1]!, "lib/rust_wasm_fixture.component.wit"), "utf8"),
    /export dependency-answer: func\(\) -> s32/,
  );
  const rebuilt = await buildCanonicalBundle(
    tmp,
    "graph-generator-selected",
    current,
    process.env,
    "//projects/apps/rust-wasm:component_rebuilt",
    canonicalArtifactToolsRoot(tmp),
    true,
  );
  assert.notEqual(rebuilt.outPath, outputs[1]);
  assert.deepEqual(
    await fs.readFile(path.join(rebuilt.outPath, "lib/rust_wasm_fixture.component.wasm")),
    await fs.readFile(component),
  );
}

export async function verifyNegativeBuilds(
  tmp: string,
  current: string,
  tools: string,
): Promise<void> {
  for (const [name, pattern] of [
    ["bad_export", /export allowlist entry is absent: missing_export/],
    ["bad_component_export", /component exports do not exactly match exported_functions/],
    [
      "bad_component_interface_allowlist",
      /component exports do not exactly match exported_functions/,
    ],
    ["bad_component_ambiguous_functions", /ambiguous duplicate exported function names/],
    ["bad_world", /world.*absent|no world named.*absent/i],
  ] as const) {
    await assert.rejects(
      buildCanonicalBundle(
        tmp,
        "graph-generator-selected",
        current,
        process.env,
        `//projects/apps/rust-wasm:${name}`,
        tools,
        true,
      ),
      pattern,
    );
  }
}

export async function verifyWasi(
  tmp: string,
  command: any,
  output: string,
  componentOutput: string,
  componentProvenanceOutput: string,
  tools: string,
): Promise<void> {
  const wasm = path.join(output, "lib/rust_wasm_fixture.wasm");
  const runner = path.join(tmp, ".viberoots/current/build-tools/tools/wasm/wasi-runner.mjs");
  const hostileBin = path.join(tmp, "hostile-bin");
  await fs.mkdir(hostileBin, { recursive: true });
  await fs.writeFile(path.join(hostileBin, "node"), "#!/bin/sh\nexit 99\n");
  await fs.chmod(path.join(hostileBin, "node"), 0o755);
  const runtimeEnv = { ...commandEnv(tmp), PATH: hostileBin };
  const pinnedNode = path.join(tools, "bin/node");
  assert.match(
    String((await command({ env: runtimeEnv })`${pinnedNode} ${runner} ${wasm}`).stdout),
    /wasi-rust-42/,
  );
  const declared = await command({ env: runtimeEnv })`${path.join(output, "bin/wasi_demo")}`;
  assert.match(String(declared.stdout), /wasi-rust-42/);
  const manifest = await readWasmManifest(componentProvenanceOutput);
  assert.equal(manifest.adapter, "wasi-preview1-reactor");
  const component = path.join(componentOutput, "lib/rust_wasm_fixture.component.wasm");
  await fs.access(component);
  assert.equal(
    String(
      await command`${path.join(manifest.tools.wasmtime, "bin/wasmtime")} run --invoke ${"add(20, 22)"} ${component}`,
    ).trim(),
    "42",
  );
}

async function readWasmManifest(provenanceOutput: string): Promise<any> {
  return JSON.parse(
    await fs.readFile(
      path.join(provenanceOutput, "share/viberoots-rust/wasm-manifest.json"),
      "utf8",
    ),
  );
}
