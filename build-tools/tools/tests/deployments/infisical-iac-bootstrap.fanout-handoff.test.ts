#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { runDeploymentBootstrapFanOut } from "../../deployments/infisical-iac-bootstrap-deployments";
import { applyFanOutMetadataHandoff } from "../../deployments/infisical-iac-bootstrap-metadata-gate";
import type { MetadataHandoffPatch } from "../../deployments/infisical-iac-bootstrap-metadata-handoff";

const staging = "//projects/deployments/pleomino/staging:deploy";
const prod = "//projects/deployments/pleomino/prod:deploy";

test("fan-out aggregates first-bootstrap handoffs separately from hard failures", async () => {
  const logs: string[] = [];
  const result = await runDeploymentBootstrapFanOut({
    args: { ...DEFAULT_BOOTSTRAP_ARGS, yes: true },
    discover: async () => ({
      offeredTargets: [staging, prod],
      unsupportedTargets: [],
      source: "graph",
    }),
    execute: async () => ({ reconciliation: { status: "metadata_handoff_required", patch } }),
    io: { stderr: (line) => logs.push(line) },
  });
  assert.deepEqual(result.successes, []);
  assert.deepEqual(
    result.metadataHandoffs.map((item) => item.target),
    [staging, prod],
  );
  assert.equal(result.failures.length, 0);
  assert.match(logs.join("\n"), /First-bootstrap metadata handoff required/);
  assert.match(logs.join("\n"), /family\.bzl/);
});

test("fan-out still fails closed when one deployment has hard drift", async () => {
  await assert.rejects(
    () =>
      runDeploymentBootstrapFanOut({
        args: { ...DEFAULT_BOOTSTRAP_ARGS, yes: true },
        discover: async () => ({
          offeredTargets: [staging, prod],
          unsupportedTargets: [],
          source: "graph",
        }),
        execute: async (args) => {
          if (args.target === prod) throw new Error("hard reviewed metadata drift");
          return { reconciliation: { status: "metadata_handoff_required", patch } };
        },
        io: { stderr: () => undefined },
      }),
    /prod:deploy: hard reviewed metadata drift/,
  );
});

test("--yes does not imply non-interactive metadata patch application", async () => {
  await assert.rejects(
    () =>
      applyFanOutMetadataHandoff(
        { ...DEFAULT_BOOTSTRAP_ARGS, yes: true, applyMetadataPatch: false },
        fanOutWithPatch(patch),
      ),
    /--apply-metadata-patch/,
  );
});

test("interactive metadata patch confirmation applies the reviewed patch", async () => {
  const tempPatch = await patchInTemp();
  await withInteractiveIo("Y\n", () =>
    applyFanOutMetadataHandoff(DEFAULT_BOOTSTRAP_ARGS, fanOutWithPatch(tempPatch)),
  );
  assert.equal(await fs.readFile(tempPatch.path, "utf8"), 'project = "proj_new"\n');
});

test("declined interactive metadata patch confirmation stops before writing", async () => {
  const tempPatch = await patchInTemp();
  await assert.rejects(
    () =>
      withInteractiveIo("n\n", () =>
        applyFanOutMetadataHandoff(DEFAULT_BOOTSTRAP_ARGS, fanOutWithPatch(tempPatch)),
      ),
    /metadata patch application cancelled/,
  );
  assert.equal(await fs.readFile(tempPatch.path, "utf8"), 'project = "proj_old"\n');
});

function fanOutWithPatch(item: MetadataHandoffPatch) {
  return {
    offeredTargets: [staging],
    skipped: false,
    successes: [],
    failures: [],
    metadataHandoffs: [{ target: staging, patch: item }],
  };
}

async function patchInTemp(): Promise<MetadataHandoffPatch> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "metadata-gate-"));
  const file = path.join(dir, "family.bzl");
  await fs.writeFile(file, 'project = "proj_old"\n');
  return { ...patch, path: file };
}

async function withInteractiveIo<T>(inputText: string, run: () => Promise<T>) {
  const oldStdin = process.stdin;
  const oldStdout = process.stdout;
  const input = new PassThrough();
  const output = new PassThrough();
  Object.assign(input, { isTTY: true });
  Object.assign(output, { isTTY: true });
  Object.defineProperty(process, "stdin", { value: input, configurable: true });
  Object.defineProperty(process, "stdout", { value: output, configurable: true });
  setTimeout(() => input.end(inputText), 0);
  try {
    return await run();
  } finally {
    Object.defineProperty(process, "stdin", { value: oldStdin, configurable: true });
    Object.defineProperty(process, "stdout", { value: oldStdout, configurable: true });
  }
}

const patch: MetadataHandoffPatch = {
  schemaVersion: "infisical-iac-bootstrap-metadata-patch@1",
  path: "projects/deployments/pleomino/shared/family.bzl",
  replacements: [{ label: "_INFISICAL_PROJECT_ID", before: "proj_old", after: "proj_new" }],
  unifiedDiff: "--- a/projects/deployments/pleomino/shared/family.bzl\n+proj_new\n",
};
