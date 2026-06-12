#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function read(rel: string) {
  return await fsp.readFile(path.join(process.cwd(), rel), "utf8");
}

test("deployment control plane docs keep reviewed-source snapshotting and mismatch guidance aligned", async () => {
  const [designDoc, miniDoc, usageDoc, sharedHostUsageDoc] = await Promise.all([
    read("docs/history/designs/deployments-design.md"),
    read("docs/history/designs/mini-deployment.md"),
    read("docs/deployments-usage.md"),
    read("docs/nixos-shared-host-usage.md"),
  ]);
  assert.match(
    designDoc,
    /submission-scoped snapshot ref[\s\S]*authoritative admitted `sourceRevision`/i,
  );
  assert.match(
    designDoc,
    /client supplies the reviewed commit it expects[\s\S]*fail closed if they differ/i,
  );
  assert.match(
    miniDoc,
    /source-ref-backed lane[\s\S]*submission-scoped snapshot ref[\s\S]*service-owned snapshot/i,
  );
  assert.match(miniDoc, /concurrent submissions[\s\S]*without clobbering/i);
  for (const doc of [usageDoc, sharedHostUsageDoc]) {
    assert.match(doc, /service-owned reviewed(?: source)?[\s\S]*snapshot/i);
    assert.match(doc, /clientExpectedSourceRevision[\s\S]*serviceReviewedSourceRevision/i);
    assert.match(doc, /--admit-for-commit <serviceReviewedSourceRevision>/i);
  }
});
