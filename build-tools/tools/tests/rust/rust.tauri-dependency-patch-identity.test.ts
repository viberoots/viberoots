#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { artifactNixIndependentPolicyArgs } from "../../lib/artifact-nix-policy";
import { runInScratchTemp } from "../lib/test-helpers";
import { killBuckDaemonsForRepo } from "../lib/test-helpers/buck-kill";
import { itoaSource } from "./rust-wasm-acceptance-fixture";
import { makeTauriCompositionConsumer } from "./rust.tauri-consumer-fixture";
import { readRemoteNixStoreFile } from "../../ci/artifact-reproducibility-semantic-manifest";

const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
const target = "//projects/apps/tauri-composition-app:desktop";
type Identity = { drvPath: string; outPath: string };

test(
  "Tauri package applies a package-local Rust dependency patch and restores exact identity",
  { timeout: 2_700_000 },
  async () => {
    await runInScratchTemp("tauri-rust-patch-identity", async (tmp, $) => {
      const fixture = await makeTauriCompositionConsumer(tmp, sourceRoot, $);
      const { consumer, sourcePath, authoringEnv, artifactEnv } = fixture;
      const identity = async (): Promise<Identity> => {
        const result = await $({ cwd: consumer, env: artifactEnv(), stdio: "pipe" })`${[
          "build-selected",
          `--artifact-workspace-root=${consumer}`,
          "--target",
          target,
          "--source=path",
          "--print-derivation-identity",
        ]}`;
        const parsed = JSON.parse(
          String(result.stdout)
            .trim()
            .split("\n")
            .findLast((line) => line.startsWith("{")) || "{}",
        ) as Identity;
        assert.match(parsed.drvPath, /^\/nix\/store\/[a-z0-9]{32}-[^/]+\.drv$/);
        assert.match(parsed.outPath, /^\/nix\/store\/[a-z0-9]{32}-[^/]+$/);
        await $({ cwd: consumer, env: artifactEnv(), stdio: "pipe" })`
          nix build --no-link ${`${parsed.drvPath}^out`}
        `;
        return parsed;
      };
      try {
        const baseline = await identity();
        const baselineManifest = await semanticManifest(baseline.outPath, artifactEnv(), $);
        const lock = path.join(consumer, "projects/apps/tauri-composition-app/Cargo.lock");
        const lockedItoa = (await fs.readFile(lock, "utf8")).match(
          /\[\[package\]\]\nname = "itoa"\nversion = "([^"]+)"\nsource = "([^"]+)"\nchecksum = "([^"]+)"/u,
        );
        assert.ok(lockedItoa);
        const [, itoaVersion, lockedSource, itoaChecksum] = lockedItoa;
        assert.equal(lockedSource, itoaSource);
        const lockStorePath = String(
          (await $({ cwd: consumer, env: authoringEnv() })`nix store add-file ${lock}`).stdout,
        ).trim();
        const expression = `let f = builtins.getFlake ${JSON.stringify(
          `path:${sourcePath}`,
        )}; pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem}; in pkgs.rustPlatform.importCargoLock { lockFile = ${JSON.stringify(
          lockStorePath,
        )}; }`;
        const vendorRoot = String(
          (
            await $({
              cwd: consumer,
              env: authoringEnv(),
            })`nix ${artifactNixIndependentPolicyArgs("reviewed")} build --impure --no-link --print-out-paths --expr ${expression}`
          ).stdout,
        ).trim();
        const remoteStore = String(authoringEnv().NIX_REMOTE || "daemon");
        await $({ cwd: consumer, env: authoringEnv() })`
          nix copy --from ${remoteStore} --to daemon ${vendorRoot}
        `;
        const dependency = (await fs.readdir(vendorRoot)).find((entry) =>
          entry.startsWith(`itoa-${itoaVersion}`),
        );
        assert.ok(dependency);
        const storePath = path.join(vendorRoot, dependency);
        const narHash = String(
          (
            await $`nix ${artifactNixIndependentPolicyArgs("empty")} hash path --type sha256 --sri ${storePath}`
          ).stdout,
        ).trim();
        const authority = { source: itoaSource, checksum: itoaChecksum!, storePath, narHash };
        const patchEnv = authoringEnv({
          NIX_RUST_DEV_OVERRIDE_JSON: "{}",
          NIX_RUST_TEST_RESOLVE_JSON: JSON.stringify({
            [`itoa@${itoaVersion}#${itoaSource}`]: {
              originPath: storePath,
              ...authority,
              buildInput: authority,
            },
          }),
        });
        const cli = path.join(sourcePath, "build-tools/tools/bin/patch-pkg");
        await $({ cwd: consumer, env: patchEnv })`${cli} start rust itoa --target ${target}`;
        const sessions = JSON.parse(
          await fs.readFile(path.join(consumer, ".patch-sessions.json"), "utf8"),
        );
        const workspace = sessions.sessions.rust[`itoa@${itoaVersion}#${itoaSource}`].workspacePath;
        await fs.writeFile(
          path.join(workspace, "src/lib.rs"),
          'pub struct Buffer { text: String }\nimpl Buffer { pub fn new() -> Self { Self { text: String::new() } } pub fn format<I>(&mut self, _: I) -> &str { self.text = "43".into(); &self.text } }\n',
        );
        await $({ cwd: consumer, env: patchEnv })`${cli} apply rust itoa --target ${target}`;
        await $({ cwd: consumer, env: authoringEnv() })`u`;
        const patched = await identity();
        const patchedManifest = await semanticManifest(patched.outPath, artifactEnv(), $);
        assert.notEqual(patched.drvPath, baseline.drvPath);
        assert.notEqual(patched.outPath, baseline.outPath);
        assert.notEqual(patchedManifest, baselineManifest);
        await $({ cwd: consumer, env: patchEnv })`${cli} start rust itoa --target ${target}`;
        await $({ cwd: consumer, env: patchEnv })`${cli} remove rust itoa --target ${target}`;
        await $({ cwd: consumer, env: authoringEnv() })`u`;
        const restored = await identity();
        assert.deepEqual(restored, baseline);
        assert.equal(await semanticManifest(restored.outPath, artifactEnv(), $), baselineManifest);
        console.log(JSON.stringify({ baseline, patched, restored }));
      } finally {
        await killBuckDaemonsForRepo(tmp, $);
      }
    });
  },
);

async function semanticManifest(
  outPath: string,
  env: NodeJS.ProcessEnv,
  $: typeof globalThis.$,
): Promise<string> {
  return (
    await readRemoteNixStoreFile(
      async (args) => await $({ env, stdio: "pipe" })`${["nix", ...args]}`,
      path.join(outPath, "share/viberoots-tauri/artifact-manifest.json"),
    )
  ).toString("utf8");
}
