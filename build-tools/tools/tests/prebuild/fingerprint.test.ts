#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { checkFreshness } from "../../buck/prebuild/freshness";
import {
  prebuildFingerprintFresh,
  writePrebuildFingerprint,
} from "../../buck/prebuild/fingerprint";
import { runInTemp } from "../lib/test-helpers";

async function seedInputAndOutput(tmp: string): Promise<{ input: string; output: string }> {
  const input = path.join(tmp, "viberoots", "build-tools", "tools", "buck", "glue-pipeline.ts");
  const output = path.join(tmp, ".viberoots", "workspace", "buck", "graph.json");
  await fsp.mkdir(path.dirname(input), { recursive: true });
  await fsp.mkdir(path.dirname(output), { recursive: true });
  await fsp.writeFile(input, "input\n", "utf8");
  await fsp.writeFile(output, "[]\n", "utf8");
  return { input, output };
}

test("prebuild fingerprint satisfies write-if-changed output freshness", async () => {
  await runInTemp("prebuild-fingerprint-fresh", async (tmp) => {
    const { input, output } = await seedInputAndOutput(tmp);
    await writePrebuildFingerprint({ root: tmp, inputs: [input], outputs: [output] });

    assert.deepEqual(
      await prebuildFingerprintFresh({ root: tmp, inputs: [input], outputs: [output] }),
      {
        fresh: true,
        reason: "fresh",
      },
    );

    const cwd = process.cwd();
    try {
      process.chdir(tmp);
      assert.equal(await checkFreshness([input], [output], 0, "local"), false);
    } finally {
      process.chdir(cwd);
    }
  });
});

test("prebuild fingerprint preserves generatedAt when proof content is unchanged", async () => {
  await runInTemp("prebuild-fingerprint-no-churn", async (tmp) => {
    const { input, output } = await seedInputAndOutput(tmp);
    await writePrebuildFingerprint({ root: tmp, inputs: [input], outputs: [output] });
    const fingerprint = path.join(
      tmp,
      ".viberoots",
      "workspace",
      "buck",
      "prebuild-fingerprint.json",
    );
    const before = JSON.parse(await fsp.readFile(fingerprint, "utf8"));

    await writePrebuildFingerprint({ root: tmp, inputs: [input], outputs: [output] });
    const after = JSON.parse(await fsp.readFile(fingerprint, "utf8"));

    assert.equal(after.generatedAt, before.generatedAt);
    assert.deepEqual(after.inputs, before.inputs);
    assert.deepEqual(after.outputs, before.outputs);
  });
});

test("prebuild fingerprint does not hide sidecar content drift", async () => {
  await runInTemp("prebuild-fingerprint-sidecar-stale", async (tmp) => {
    const input = path.join(tmp, "input.bzl");
    const buckDir = path.join(tmp, ".viberoots", "workspace", "buck");
    const graph = path.join(buckDir, "graph.json");
    const sidecar = path.join(buckDir, "node-lock-index.json");
    await fsp.mkdir(buckDir, { recursive: true });
    await fsp.writeFile(input, "input\n", "utf8");
    await fsp.writeFile(
      graph,
      JSON.stringify({
        nodes: [
          {
            name: "//projects/apps/demo:app",
            labels: ["lockfile:projects/apps/demo/pnpm-lock.yaml#projects/apps/demo"],
          },
        ],
      }) + "\n",
      "utf8",
    );
    await fsp.writeFile(sidecar, JSON.stringify({ index: {} }) + "\n", "utf8");
    await writePrebuildFingerprint({ root: tmp, inputs: [input], outputs: [graph] });

    const cwd = process.cwd();
    try {
      process.chdir(tmp);
      assert.equal(await checkFreshness([input], [graph], 0, "local"), true);
    } finally {
      process.chdir(cwd);
    }
  });
});

test("prebuild fingerprint rejects newer source input drift", async () => {
  await runInTemp("prebuild-fingerprint-input-stale", async (tmp) => {
    const { input, output } = await seedInputAndOutput(tmp);
    await writePrebuildFingerprint({ root: tmp, inputs: [input], outputs: [output] });

    await fsp.writeFile(input, "changed input\n", "utf8");

    const stale = await prebuildFingerprintFresh({ root: tmp, inputs: [input], outputs: [output] });
    assert.equal(stale.fresh, false);
    assert.equal(stale.reason, "input-hash-changed");

    const cwd = process.cwd();
    try {
      process.chdir(tmp);
      assert.equal(await checkFreshness([input], [output], 0, "local"), true);
    } finally {
      process.chdir(cwd);
    }
  });
});

test("prebuild fingerprint rejects changed input or output sets", async () => {
  await runInTemp("prebuild-fingerprint-set-changed", async (tmp) => {
    const { input, output } = await seedInputAndOutput(tmp);
    const addedInput = path.join(tmp, "extra.bzl");
    const addedOutput = path.join(tmp, ".viberoots", "workspace", "buck", "extra.json");
    await fsp.writeFile(addedInput, "extra\n", "utf8");
    await fsp.writeFile(addedOutput, "{}\n", "utf8");
    await writePrebuildFingerprint({ root: tmp, inputs: [input], outputs: [output] });

    const inputSet = await prebuildFingerprintFresh({
      root: tmp,
      inputs: [input, addedInput],
      outputs: [output],
    });
    assert.equal(inputSet.fresh, false);
    assert.equal(inputSet.reason, "input-set-changed");

    const removedInput = await prebuildFingerprintFresh({
      root: tmp,
      inputs: [],
      outputs: [output],
    });
    assert.equal(removedInput.fresh, false);
    assert.equal(removedInput.reason, "input-set-changed");

    const outputSet = await prebuildFingerprintFresh({
      root: tmp,
      inputs: [input],
      outputs: [output, addedOutput],
    });
    assert.equal(outputSet.fresh, false);
    assert.equal(outputSet.reason, "output-set-changed");
  });
});

test("prebuild fingerprint accepts recorded output supersets", async () => {
  await runInTemp("prebuild-fingerprint-output-superset", async (tmp) => {
    const { input, output } = await seedInputAndOutput(tmp);
    const extraOutput = path.join(tmp, ".viberoots", "workspace", "buck", "extra.json");
    await fsp.writeFile(extraOutput, "{}\n", "utf8");

    await writePrebuildFingerprint({ root: tmp, inputs: [input], outputs: [output, extraOutput] });

    assert.deepEqual(
      await prebuildFingerprintFresh({ root: tmp, inputs: [input], outputs: [output] }),
      {
        fresh: true,
        reason: "fresh",
      },
    );
  });
});

test("prebuild fingerprint rejects missing outputs and malformed records", async () => {
  await runInTemp("prebuild-fingerprint-rejects", async (tmp) => {
    const { input, output } = await seedInputAndOutput(tmp);
    const fingerprint = path.join(
      tmp,
      ".viberoots",
      "workspace",
      "buck",
      "prebuild-fingerprint.json",
    );
    await fsp.mkdir(path.dirname(fingerprint), { recursive: true });
    await fsp.writeFile(fingerprint, "{ bad json", "utf8");
    assert.equal(
      (
        await prebuildFingerprintFresh({
          root: tmp,
          inputs: [input],
          outputs: [output],
        })
      ).reason,
      "missing-or-invalid-fingerprint",
    );

    await fsp.writeFile(
      fingerprint,
      JSON.stringify({ schema: 999, inputs: [], outputs: [] }),
      "utf8",
    );
    assert.equal(
      (
        await prebuildFingerprintFresh({
          root: tmp,
          inputs: [input],
          outputs: [output],
        })
      ).reason,
      "missing-or-invalid-fingerprint",
    );

    await writePrebuildFingerprint({ root: tmp, inputs: [input], outputs: [output] });
    await fsp.rm(output);
    const missing = await prebuildFingerprintFresh({
      root: tmp,
      inputs: [input],
      outputs: [output],
    });
    assert.equal(missing.fresh, false);
    assert.equal(missing.reason, "missing-output");
  });
});
