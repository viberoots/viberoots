#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInScratchTemp } from "../lib/test-helpers";
import { killBuckDaemonsForRepo } from "../lib/test-helpers/buck-kill";
import { makeTauriCompositionConsumer } from "./rust.tauri-consumer-fixture";

process.env.TEST_NEED_DEV_ENV = "1";
const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
const target = "//projects/apps/tauri-composition-app:desktop";

type SelectedIdentity = { drvPath: string; outPath: string };
type TauriInvalidationCase =
  | { id: string; kind: "selected-inputs"; inputs: string[] }
  | { id: string; kind: "workspace-control" };

const DECLARED_INPUTS = [
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

const CASES: TauriInvalidationCase[] = [
  { id: "declared-inputs-1", kind: "selected-inputs", inputs: DECLARED_INPUTS.slice(0, 3) },
  { id: "declared-inputs-2", kind: "selected-inputs", inputs: DECLARED_INPUTS.slice(3, 6) },
  { id: "declared-inputs-3", kind: "selected-inputs", inputs: DECLARED_INPUTS.slice(6, 9) },
  { id: "workspace-control", kind: "workspace-control" },
];

const selectedCaseId = process.env.VBR_TAURI_INPUT_INVALIDATION_CASE || "declared-inputs-1";
const selectedCase = CASES.find((candidate) => candidate.id === selectedCaseId);
assert.ok(
  selectedCase,
  `unknown VBR_TAURI_INPUT_INVALIDATION_CASE=${JSON.stringify(
    selectedCaseId,
  )}; expected one of ${CASES.map((candidate) => candidate.id).join(", ")}`,
);

test(
  `real Tauri identities track and restore declared authority (${selectedCase.id})`,
  { timeout: 2_700_000 },
  async (context) => {
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
        if (selectedCase.kind === "selected-inputs") {
          const baseline = await identity();
          await context.test(
            `${selectedCase.id} selected identity tracks each declared input`,
            async () => {
              for (const relative of selectedCase.inputs) {
                const file = path.join(consumer, relative);
                const original = await fsp.readFile(file);
                await fsp.writeFile(file, Buffer.concat([original, Buffer.from("\nmutation\n")]));
                const changed = await identity();
                assert.notEqual(changed.drvPath, baseline.drvPath, `${relative} retained drvPath`);
                assert.notEqual(changed.outPath, baseline.outPath, `${relative} retained outPath`);
                await fsp.writeFile(file, original);
                assert.deepEqual(
                  await identity(),
                  baseline,
                  `${relative} did not restore identity`,
                );
              }
            },
          );
        }
        if (selectedCase.kind === "workspace-control") {
          const baseline = await identity();
          await context.test(
            "workspace control metadata does not invalidate identity",
            async () => {
              const workspaceTargets = path.join(consumer, ".viberoots/workspace/TARGETS");
              const original = await fsp.readFile(workspaceTargets);
              try {
                await fsp.writeFile(
                  workspaceTargets,
                  Buffer.concat([
                    original,
                    Buffer.from("\n# unrelated workspace control metadata\n"),
                  ]),
                );
                assert.deepEqual(await identity(), baseline);
              } finally {
                await fsp.writeFile(workspaceTargets, original);
              }
              assert.deepEqual(await identity(), baseline);
            },
          );
        }
      } finally {
        await killBuckDaemonsForRepo(tmp, $);
      }
    });
  },
);
