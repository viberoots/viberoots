#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInScratchTemp } from "../lib/test-helpers";
import { killBuckDaemonsForRepo } from "../lib/test-helpers/buck-kill";
import { buildTauriOutPath, makeTauriCompositionConsumer } from "./rust.tauri-consumer-fixture";

process.env.TEST_NEED_DEV_ENV = "1";
const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
const target = "//projects/apps/tauri-composition-app:desktop";

type SelectedIdentity = { drvPath: string; outPath: string };

async function findFile(root: string, basename: string): Promise<string> {
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of await fsp.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile() && entry.name === basename) return file;
    }
  }
  throw new Error(`missing ${basename} under ${root}`);
}

async function packageExecutable(
  consumer: string,
  artifactEnv: () => NodeJS.ProcessEnv,
  $: typeof globalThis.$,
): Promise<string> {
  const outPath = await buildTauriOutPath(consumer, artifactEnv(), target, $);
  const manifest = JSON.parse(
    await fsp.readFile(path.join(outPath, "share/viberoots-tauri/artifact-manifest.json"), "utf8"),
  );
  const executable = String(manifest.appExecutable || "");
  await fsp.access(executable);
  return executable;
}

test(
  "real selected Tauri identity tracks and restores every declared authority",
  { timeout: 2_700_000 },
  async () => {
    await runInScratchTemp("tauri-selected-invalidation", async (tmp, $) => {
      const fixture = await makeTauriCompositionConsumer(tmp, sourceRoot, $);
      const { consumer, artifactEnv } = fixture;
      const identity = async (): Promise<SelectedIdentity> => {
        const result = await $({ cwd: consumer, env: artifactEnv(), stdio: "pipe" })`${[
          "build-selected",
          `--artifact-workspace-root=${consumer}`,
          "--target",
          target,
          "--source=path",
          "--print-derivation-identity",
        ]}`;
        const line = String(result.stdout)
          .trim()
          .split("\n")
          .findLast((candidate) => candidate.startsWith("{"));
        const parsed = JSON.parse(line || "{}") as SelectedIdentity;
        assert.match(parsed.drvPath, /^\/nix\/store\/[a-z0-9]{32}-[^/]+\.drv$/);
        assert.match(parsed.outPath, /^\/nix\/store\/[a-z0-9]{32}-[^/]+$/);
        return parsed;
      };
      try {
        const baseline = await identity();
        const inputs = [
          "projects/apps/tauri-composition-app/src/main.rs",
          "projects/apps/tauri-composition-app/composition.js",
          "projects/apps/tauri-composition-app/tauri.conf.json",
          "projects/apps/tauri-composition-app/capabilities/default.json",
          "projects/apps/tauri-composition-app/permissions/report-composition-evidence.toml",
          "projects/apps/tauri-composition-app/permissions/report-composition-failure.toml",
          "projects/apps/tauri-composition-app/resource.txt",
          "projects/apps/tauri-composition-app/sidecar.c",
          "projects/apps/tauri-composition-app/icons/icon.png",
        ];
        for (const relative of inputs) {
          const file = path.join(consumer, relative);
          const original = await fsp.readFile(file);
          await fsp.writeFile(file, Buffer.concat([original, Buffer.from("\nmutation\n")]));
          const changed = await identity();
          assert.notEqual(changed.drvPath, baseline.drvPath, `${relative} retained drvPath`);
          assert.notEqual(changed.outPath, baseline.outPath, `${relative} retained outPath`);
          await fsp.writeFile(file, original);
          assert.deepEqual(await identity(), baseline, `${relative} did not restore identity`);
        }
      } finally {
        await killBuckDaemonsForRepo(tmp, $);
      }
    });
  },
);

test(
  "real Tauri package identity restores exactly after resource mutation",
  { timeout: 2_700_000 },
  async () => {
    await runInScratchTemp("tauri-package-restoration", async (tmp, $) => {
      const { consumer, artifactEnv } = await makeTauriCompositionConsumer(tmp, sourceRoot, $);
      try {
        const baselineExecutable = await packageExecutable(consumer, artifactEnv, $);
        const resource = path.join(consumer, "projects/apps/tauri-composition-app/resource.txt");
        const originalResource = await fsp.readFile(resource);
        await fsp.writeFile(
          resource,
          Buffer.concat([originalResource, Buffer.from("\npackage\n")]),
        );
        const changedExecutable = await packageExecutable(consumer, artifactEnv, $);
        await fsp.writeFile(resource, originalResource);
        const restoredExecutable = await packageExecutable(consumer, artifactEnv, $);
        console.log(
          JSON.stringify({
            baselineExecutable,
            changedExecutable,
            restoredExecutable,
          }),
        );
        assert.notEqual(
          changedExecutable,
          baselineExecutable,
          "real packaged executable identity ignored the resource mutation",
        );
        assert.equal(
          restoredExecutable,
          baselineExecutable,
          "real package identity did not restore exactly",
        );
      } finally {
        await killBuckDaemonsForRepo(tmp, $);
      }
    });
  },
);
