import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  artifactNixIndependentPolicyArgs,
  REVIEWED_EVIDENCE_PUBLIC_KEY,
} from "../../lib/artifact-nix-policy";
import { materializeNixStorePaths } from "../../remote-exec/nix-store-materialize";
import { groupWasmCacheManifests } from "./rust-wasm-cache-manifests";
import { verifyPatchLifecycle } from "./rust-wasm-patch-lifecycle";

export type WasmAcceptanceContext = {
  tmp: string;
  command: any;
  root: string;
  outputs: string[];
  provenanceOutputs: string[];
  debugOutput: string;
  debugProvenanceOutput: string;
  currentInput: string;
  artifactToolsRoot: string;
  allowMissingWasiToolchain: boolean;
};

export function selectWasmCacheOutputs(
  outputs: string[],
  debugOutput: string,
  allowMissingWasiToolchain: boolean,
): string[] {
  assert.equal(outputs.length, allowMissingWasiToolchain ? 4 : 7);
  return [...outputs, debugOutput];
}

export async function verifyCacheAndPatch(context: WasmAcceptanceContext): Promise<void> {
  const {
    tmp,
    command: $,
    root,
    outputs,
    provenanceOutputs,
    debugOutput,
    debugProvenanceOutput,
    currentInput,
    artifactToolsRoot,
  } = context;
  const cacheOutputs = selectWasmCacheOutputs(
    outputs,
    debugOutput,
    context.allowMissingWasiToolchain,
  );
  const cache = path.join(tmp, "wasm-binary-cache");
  await fs.mkdir(cache);
  const nix = path.join(artifactToolsRoot, "bin/nix");
  const emptyNixPolicy = artifactNixIndependentPolicyArgs("empty");
  const secretKey = path.join(tmp, "wasm-cache-secret-key");
  const secret = String(
    await $({
      cwd: tmp,
      stdio: "pipe",
    })`${nix} ${emptyNixPolicy} key generate-secret --key-name viberoots-wasm-test-cache-1`,
  );
  await fs.writeFile(secretKey, secret, { mode: 0o600 });
  const publicKey = String(
    await $({
      cwd: tmp,
      input: secret,
      stdio: "pipe",
    })`${nix} ${emptyNixPolicy} key convert-secret-to-public`,
  ).trim();
  await $({
    cwd: tmp,
    stdio: "pipe",
  })`${nix} ${emptyNixPolicy} copy --to ${`file://${cache}`} ${cacheOutputs}`;
  await $({
    cwd: tmp,
    stdio: "pipe",
  })`${nix} ${emptyNixPolicy} --store ${`file://${cache}`} store sign --key-file ${secretKey} --recursive ${cacheOutputs}`;
  const manifests = await Promise.all(
    [...provenanceOutputs, debugProvenanceOutput].map(async (output) =>
      JSON.parse(
        await fs.readFile(
          path.join(output, "share/viberoots-rust/materialization-manifest.json"),
          "utf8",
        ),
      ),
    ),
  );
  const reviewedEndpoint = "https://cache.home.kilty.io/main";
  const replayManifests = groupWasmCacheManifests(manifests);
  assert.ok(
    replayManifests.every(
      (manifest) =>
        /^\/nix\/store\//.test(manifest.sourceSnapshot) &&
        manifest.storePaths.every((entry) => entry.path.startsWith("/nix/store/")),
    ),
  );
  assert.deepEqual(
    replayManifests.flatMap((manifest) => manifest.storePaths.map((entry) => entry.path)).sort(),
    [...cacheOutputs].sort(),
  );
  const coldStore = path.join(tmp, "cold-wasm-nix-store");
  const reports = [];
  for (const manifest of replayManifests) {
    reports.push(
      ...(await materializeNixStorePaths({
        manifest,
        artifactToolsRoot,
        runner: async (command) => {
          const [executable, ...args] = command.map((part) => {
            if (part === reviewedEndpoint) return `file://${cache}`;
            return part.includes(REVIEWED_EVIDENCE_PUBLIC_KEY)
              ? part.replace(REVIEWED_EVIDENCE_PUBLIC_KEY, publicKey)
              : part;
          });
          const result = await $({
            cwd: tmp,
            stdio: "pipe",
          })`${executable!} --store ${`local?root=${coldStore}`} ${args}`;
          return { stdout: String(result.stdout), stderr: String(result.stderr) };
        },
      })),
    );
  }
  assert.ok(reports.every((report) => report.cache === "hit"));
  assert.deepEqual(reports.map((report) => report.path).sort(), [...cacheOutputs].sort());
  const coldRaw = `${coldStore}${outputs[2]}/lib/rust_wasm_fixture.wasm`;
  const raw = await WebAssembly.instantiate(await fs.readFile(coldRaw));
  assert.equal((raw.instance.exports.answer as () => number)(), 42);
  const coldBrowser = `${coldStore}${outputs[0]}/pkg`;
  const bindings = await import(
    `${pathToFileURL(path.join(coldBrowser, "rust_wasm_fixture.js")).href}?cold=1`
  );
  await bindings.default(await fs.readFile(path.join(coldBrowser, "rust_wasm_fixture_bg.wasm")));
  assert.equal(bindings.answer(), 42);
  await verifyPatchLifecycle(context, nix);
}
