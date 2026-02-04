#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildInlinePlan } from "../../buck/export-inline.ts";
import { getImporterRootsContract } from "../../lib/importer-roots.ts";

test("export-inline: with --target includes platform flags and deps(target)", async () => {
  const prevNoIso = process.env.BUCK_NO_ISOLATION;
  process.env.BUCK_NO_ISOLATION = "1";
  try {
    const { workspaceRoots } = getImporterRootsContract();
    const plan = buildInlinePlan({
      workspaceRoot: "/tmp/work",
      outPath: path.join("/tmp/work", "out.json"),
      target: "//apps/web:bundle",
      roots: workspaceRoots,
      includeTargetPlatforms: true,
      normalizeLabels: true,
    });
    assert.ok(Array.isArray(plan.platformFlags) && plan.platformFlags.length > 0);
    assert.match(plan.query, /deps\(\/\/apps\/web:bundle, 1, exec_deps\(\)\)\)$/);
    assert.equal(Array.isArray(plan.isoArgs) && plan.isoArgs.length, 0);
  } finally {
    if (prevNoIso === undefined) delete process.env.BUCK_NO_ISOLATION;
    else process.env.BUCK_NO_ISOLATION = prevNoIso;
  }
});

test("export-inline: without --target omits platform flags and uses roots set()", async () => {
  const prevNoIso = process.env.BUCK_NO_ISOLATION;
  process.env.BUCK_NO_ISOLATION = "1";
  try {
    const { workspaceRoots } = getImporterRootsContract();
    const plan = buildInlinePlan({
      workspaceRoot: "/tmp/work",
      outPath: path.join("/tmp/work", "out.json"),
      roots: workspaceRoots,
      includeTargetPlatforms: false,
      normalizeLabels: false,
    });
    assert.ok(Array.isArray(plan.platformFlags) && plan.platformFlags.length === 0);
    assert.match(plan.query, /^deps\(set\(.+\), 1, exec_deps\(\)\)$/);
    for (const r of workspaceRoots) {
      assert.ok(
        plan.query.includes(`//${r}/...`),
        `expected query to include root //${r}/... but it did not: ${plan.query}`,
      );
    }
    assert.equal(Array.isArray(plan.isoArgs) && plan.isoArgs.length, 0);
  } finally {
    if (prevNoIso === undefined) delete process.env.BUCK_NO_ISOLATION;
    else process.env.BUCK_NO_ISOLATION = prevNoIso;
  }
});
