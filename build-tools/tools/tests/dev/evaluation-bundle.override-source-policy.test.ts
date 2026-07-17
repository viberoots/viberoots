#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { materializeEvaluationBundle } from "../../dev/evaluation-bundle";

async function sourceFixture(root: string): Promise<void> {
  await fsp.mkdir(path.join(root, ".viberoots", "workspace", "buck"), { recursive: true });
  await fsp.writeFile(path.join(root, "flake.nix"), "{ outputs = _: {}; }\n");
  await fsp.writeFile(path.join(root, ".viberoots", "workspace", "buck", "graph.json"), "[]\n");
}

test("bundle rejects generated state inside an override source", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "bundle-override-generated-"));
  const source = path.join(tmp, "source");
  const override = path.join(tmp, "override");
  await sourceFixture(source);
  await fsp.mkdir(path.join(override, "node_modules"), { recursive: true });
  await fsp.writeFile(path.join(override, "node_modules", "credential.txt"), "not-source\n");
  try {
    await assert.rejects(
      materializeEvaluationBundle({
        stagedSource: source,
        attr: "graph-generator",
        classification: "local-development",
        selectorEnv: { NIX_GO_DEV_OVERRIDE_JSON: JSON.stringify({ module: override }) },
      }),
      /override source contains excluded path: node_modules/,
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("bundle rejects an override ancestor that would recursively capture staging", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "bundle-override-recursive-"));
  const source = path.join(tmp, "source");
  const priorTmp = process.env.TMPDIR;
  await sourceFixture(source);
  process.env.TMPDIR = tmp;
  try {
    await assert.rejects(
      materializeEvaluationBundle({
        stagedSource: source,
        attr: "graph-generator",
        classification: "local-development",
        selectorEnv: { NIX_CPP_DEV_OVERRIDE_JSON: JSON.stringify({ "pkgs.demo": tmp }) },
      }),
      /override source contains the bundle staging root/,
    );
  } finally {
    if (priorTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = priorTmp;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("bundle resolves an override alias before checking recursive capture", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "bundle-override-alias-"));
  const source = path.join(tmp, "source");
  const alias = `${tmp}-alias`;
  const priorTmp = process.env.TMPDIR;
  await sourceFixture(source);
  await fsp.symlink(tmp, alias);
  process.env.TMPDIR = tmp;
  try {
    await assert.rejects(
      materializeEvaluationBundle({
        stagedSource: source,
        attr: "graph-generator",
        classification: "local-development",
        selectorEnv: { NIX_CPP_DEV_OVERRIDE_JSON: JSON.stringify({ "pkgs.demo": alias }) },
      }),
      /override source contains the bundle staging root/,
    );
  } finally {
    if (priorTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = priorTmp;
    await fsp.rm(alias, { force: true });
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
