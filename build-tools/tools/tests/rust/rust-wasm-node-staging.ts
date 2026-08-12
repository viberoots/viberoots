import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { admitKubernetesComponentArtifacts } from "../../deployments/kubernetes-artifacts";
import {
  artifactIdentityForNodeServiceDir,
  createNodeServiceArtifact,
} from "../../node/service-artifact";
import { exportGraphInTemp } from "../lib/test-helpers";

export async function verifyNodeStages(
  tmp: string,
  command: any,
  immutableInput: string,
): Promise<void> {
  const root = path.join(tmp, "projects/apps/rust-wasm-node");
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  await fs.writeFile(
    path.join(root, "TARGETS"),
    [
      'load("@prelude//:rules.bzl", "genrule")',
      'load("@viberoots//build-tools/node:defs.bzl", "node_asset_stage", "node_wasm_inline_module")',
      `genrule(name = "package", out = "package", cmd = "mkdir -p $OUT/dist && printf '{\\"schemaVersion\\":\\"viberoots.node-wasm-assets.v1\\"}' > $OUT/asset-manifest.json && printf 'export const ready = true;\\\\n' > $OUT/index.js && printf '{\\"type\\":\\"module\\"}\\\\n' > $OUT/package.json && cp $OUT/asset-manifest.json $OUT/index.js $OUT/package.json $OUT/dist/")`,
      'node_wasm_inline_module(name = "inline", src = "//projects/apps/rust-wasm:browser", provenance = "//projects/apps/rust-wasm:browser[provenance]", artifact_name = "rust_wasm_fixture_bg.wasm", out = "rust-inline.js")',
      'node_asset_stage(name = "webapp", app = ":package", assets = [{"src": "//projects/apps/rust-wasm:browser", "provenance": "//projects/apps/rust-wasm:browser[provenance]", "artifact_name": "rust_wasm_fixture_bg.wasm", "dest": "client/wasm/rust.wasm"}], labels = ["lang:node", "kind:app", "webapp:static"])',
      'node_asset_stage(name = "ssr", app = ":package", assets = [{"src": "//projects/apps/rust-wasm:browser", "provenance": "//projects/apps/rust-wasm:browser[provenance]", "artifact_name": "rust_wasm_fixture_bg.wasm", "dest": "server/wasm/rust.wasm"}], labels = ["lang:node", "kind:app", "webapp:ssr"])',
      'node_asset_stage(name = "service", app = ":package", assets = [{"src": "//projects/apps/rust-wasm:raw", "provenance": "//projects/apps/rust-wasm:raw[provenance]", "dest": "server/wasm/raw.wasm"}], labels = ["lang:node", "kind:app", "deployment-component:service"])',
      'node_asset_stage(name = "component", app = ":package", assets = [{"src": "//projects/apps/rust-wasm:component", "provenance": "//projects/apps/rust-wasm:component[provenance]", "artifact_name": "rust_wasm_fixture.component.wasm", "dest": "components/calculator.wasm"}], labels = ["lang:node", "kind:app", "deployment-component:artifact"])',
      'node_asset_stage(name = "cli", app = ":package", assets = [{"src": ":inline", "output_path": "rust-inline.js", "dest": "lib/wasm/rust-inline.js"}], labels = ["lang:node", "kind:bin"])',
      "",
    ].join("\n"),
  );
  await command`git add -A projects/apps/rust-wasm-node`;
  await exportGraphInTemp({
    tmp,
    $: command,
    env: { VIBEROOTS_FLAKE_INPUT_ROOT: immutableInput },
  });
  const buildLabel = async (label: string) => {
    const result = await command({
      env: {
        ...process.env,
        VIBEROOTS_FLAKE_INPUT_ROOT: immutableInput,
        VIBEROOTS_ROOT: immutableInput,
        VIBEROOTS_SOURCE_ROOT: immutableInput,
      },
    })`buck2 build --target-platforms prelude//platforms:default --show-output ${label}`;
    const output = String(result.stdout || result.stderr)
      .trim()
      .split(/\n+/)
      .at(-1)!
      .split(/\s+/)
      .at(-1)!;
    return path.isAbsolute(output) ? output : path.join(tmp, output);
  };
  const declaredFlake = await buildLabel("//.viberoots/workspace:flake.nix");
  assert.match(await fs.readFile(declaredFlake, "utf8"), /\bviberoots\.url\s*=/);
  const stages: string[] = [];
  for (const name of ["webapp", "ssr", "service", "cli", "component"]) {
    stages.push(await buildLabel(`//projects/apps/rust-wasm-node:${name}`));
  }
  for (const [index, destination] of [
    "client/wasm/rust.wasm",
    "server/wasm/rust.wasm",
    "server/wasm/raw.wasm",
    "lib/wasm/rust-inline.js",
    "components/calculator.wasm",
  ].entries()) {
    await fs.access(path.join(stages[index], destination));
    const manifest = JSON.parse(
      await fs.readFile(path.join(stages[index], "asset-manifest.json"), "utf8"),
    );
    assert.equal(manifest.schemaVersion, "viberoots.node-wasm-assets.v1");
    const bytes = await fs.readFile(path.join(stages[index], destination));
    if (destination.endsWith(".js")) {
      assert.deepEqual(
        manifest.assets,
        [],
        `${destination} is a JavaScript consumer and must not be recorded as raw WASM`,
      );
      const match = bytes.toString("utf8").match(/^export const wasmProducer = (\{[^\n]+\});$/m);
      assert.ok(match, `${destination} must embed its WASM producer lineage`);
      const producer = JSON.parse(match[1]!);
      assert.match(producer.storePath, /^\/nix\/store\//);
      assert.equal(producer.outputIdentity, path.basename(producer.storePath));
      assert.match(producer.sourceRevision, /^[a-f0-9]{64}$/);
      assert.match(producer.compositionDigest, /^[a-f0-9]{64}$/);
      continue;
    }
    assert.equal(
      manifest.assets.length,
      1,
      `${destination} staged manifest must contain exactly one asset: ${JSON.stringify(manifest)}`,
    );
    assert.equal(manifest.assets[0].destination, destination);
    assert.equal(
      manifest.assets[0].sha256,
      `sha256-${createHash("sha256").update(bytes).digest("hex")}`,
    );
    assert.match(manifest.assets[0].declaredSource, /rust-wasm|:inline/);
    assert.match(manifest.assets[0].resolvedSource, /^(?:\/nix\/store\/|buck:|content:)/);
    assert.doesNotMatch(manifest.assets[0].resolvedSource, new RegExp(tmp));
    assert.match(manifest.assets[0].producer.storePath, /^\/nix\/store\//);
    assert.equal(
      manifest.assets[0].producer.outputIdentity,
      path.basename(manifest.assets[0].producer.storePath),
    );
    assert.match(manifest.assets[0].producer.sourceRevision, /^[a-f0-9]{64}$/);
    assert.match(manifest.assets[0].producer.compositionDigest, /^[a-f0-9]{64}$/);
  }
  const contractPath = path.join(tmp, "rust-wasm-service.runtime.json");
  await fs.writeFile(
    contractPath,
    JSON.stringify({
      schemaVersion: "node-service-runtime@1",
      serviceName: "rust-wasm-service",
      entrypoint: "index.js",
      productionCommand: ["node", "dist/index.js"],
      health: { path: "/healthz", port: 3000 },
      runtimeConfig: [],
      secretRequirements: [],
    }),
  );
  const deployables: Record<string, string> = {};
  const identities: Record<string, string> = {};
  for (const [name, index] of [
    ["webapp", 0],
    ["ssr", 1],
    ["service", 2],
    ["cli", 3],
    ["component", 4],
  ] as const) {
    const deployable = path.join(tmp, `rust-wasm-${name}-artifact`);
    deployables[name] = deployable;
    identities[name] = await createNodeServiceArtifact({
      distDir: stages[index]!,
      contractPath,
      packageJsonPath: path.join(stages[index]!, "package.json"),
      outDir: deployable,
      identityPath: path.join(deployable, "artifact-identity.json"),
    });
  }
  const admitted = await admitKubernetesComponentArtifacts({
    recordsRoot: path.join(tmp, "rust-wasm-deployment-records"),
    artifactPathsByComponentId: deployables,
  });
  for (const record of admitted) {
    assert.equal(record.identity, identities[record.componentId]);
    assert.equal(record.sourceKind, "directory");
    assert.equal(
      await artifactIdentityForNodeServiceDir(record.storedArtifactPath),
      record.identity,
    );
  }
  const admittedById = Object.fromEntries(admitted.map((record) => [record.componentId, record]));
  await fs.access(path.join(admittedById.webapp.storedArtifactPath, "dist/client/wasm/rust.wasm"));
  await fs.access(path.join(admittedById.ssr.storedArtifactPath, "dist/server/wasm/rust.wasm"));
  await fs.access(path.join(admittedById.service.storedArtifactPath, "dist/server/wasm/raw.wasm"));
  await fs.access(path.join(admittedById.cli.storedArtifactPath, "dist/lib/wasm/rust-inline.js"));
  await fs.access(
    path.join(admittedById.component.storedArtifactPath, "dist/components/calculator.wasm"),
  );
}
