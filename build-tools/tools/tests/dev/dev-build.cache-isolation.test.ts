#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  artifactBuckAuthorityBinding,
  artifactBuckIsolation,
  reconcileArtifactBuckIsolation,
} from "../../dev/dev-build/cache-isolation";
import { createIsolation } from "../../dev/dev-build/isolation";
import { nixCachePolicyBindingDigest } from "../../lib/nix-cache-policy-capability";

const BINDING_A = "a".repeat(64);
const BINDING_B = "b".repeat(64);

test("same cache-policy binding reuses the same bounded Buck isolation", () => {
  const first = artifactBuckIsolation("devbuild-shared-example", BINDING_A, "linux");
  const second = artifactBuckIsolation("devbuild-shared-example", BINDING_A, "linux");
  assert.equal(first, second);
  assert.equal(first, `devbuild-shared-example-artifact-cache-${"a".repeat(24)}`);
  assert.ok(first.length < 80);
});

test("Darwin Buck cache isolation keeps the physical directory under .noindex", () => {
  assert.equal(
    artifactBuckIsolation("devbuild-shared-example.noindex", BINDING_A, "darwin"),
    `devbuild-shared-example-artifact-cache-${"a".repeat(24)}.noindex`,
  );
});

test("changed cache-policy binding selects a different Buck isolation", () => {
  assert.notEqual(
    artifactBuckIsolation("devbuild-shared-example", BINDING_A),
    artifactBuckIsolation("devbuild-shared-example", BINDING_B),
  );
});

test("graph and source authority participate in reusable Buck isolation identity", () => {
  const bind = (graph: string, source: string) =>
    artifactBuckAuthorityBinding({
      cachePolicyBinding: BINDING_A,
      graphBytes: Buffer.from(graph),
      artifactToolsRoot: source,
    });
  const first = bind("graph-a", "/nix/store/source-a");
  assert.equal(first, bind("graph-a", "/nix/store/source-a"));
  assert.notEqual(first, bind("graph-b", "/nix/store/source-a"));
  assert.notEqual(first, bind("graph-a", "/nix/store/source-b"));
  assert.equal(
    artifactBuckIsolation("devbuild-shared-example", first),
    artifactBuckIsolation("devbuild-shared-example", first),
  );
});

test("Buck isolation argv and cleanup logic expose only the digest-derived identity", async () => {
  const secretMarker = "do-not-expose-cache-secret";
  const privateCache = `https://cache.internal.invalid/${secretMarker}`;
  const binding = nixCachePolicyBindingDigest({
    kind: "reviewed",
    config: `substituters = ${privateCache}`,
    policy: "strict",
    requiredSubstituters: [privateCache],
    optionalSubstituters: [],
  });
  const isolation = createIsolation({ cachePolicyBinding: binding, reuseDaemon: true });
  const renderedArgv = isolation.isolationFlags.join(" ");

  assert.match(renderedArgv, /^[A-Za-z0-9._ -]+$/u);
  assert.ok(renderedArgv.includes(binding.slice(0, 24)));
  assert.ok(!renderedArgv.includes(secretMarker));
  assert.ok(!renderedArgv.includes(privateCache));
  const cleanupSource = await fsp.readFile(
    "viberoots/build-tools/tools/dev/dev-build/cache-isolation.ts",
    "utf8",
  );
  assert.doesNotMatch(cleanupSource, /console\.(?:log|warn|error)/u);
});

test("binding reconciliation reuses the same daemon and retires only the changed binding", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-cache-isolation-"));
  const killed: string[] = [];
  const killIsolation = async (_root: string, isolation: string) => {
    killed.push(isolation);
  };
  try {
    const first = await reconcileArtifactBuckIsolation({
      root,
      baseIsolation: "devbuild-shared-example",
      binding: BINDING_A,
      killIsolation,
    });
    const same = await reconcileArtifactBuckIsolation({
      root,
      baseIsolation: "devbuild-shared-example",
      binding: BINDING_A,
      killIsolation,
    });
    const changed = await reconcileArtifactBuckIsolation({
      root,
      baseIsolation: "devbuild-shared-example",
      binding: BINDING_B,
      killIsolation,
    });

    assert.deepEqual(first.killed, []);
    assert.equal(same.isolation, first.isolation);
    assert.deepEqual(same.killed, []);
    assert.deepEqual(changed.killed, [first.isolation]);
    assert.deepEqual(killed, [first.isolation]);

    const stateFile = path.join(
      root,
      "buck-out",
      "artifact-cache-isolations",
      "devbuild-shared-example.json",
    );
    const state = JSON.parse(await fsp.readFile(stateFile, "utf8"));
    assert.deepEqual(state, { binding: BINDING_B, isolation: changed.isolation });
    assert.equal((await fsp.stat(stateFile)).mode & 0o777, 0o600);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("owned-isolation teardown is bound to the derived cache identity", async () => {
  const isolation = createIsolation({ cachePolicyBinding: BINDING_A, reuseDaemon: false });
  const source = await fsp.readFile(
    "viberoots/build-tools/tools/dev/dev-build/isolation.ts",
    "utf8",
  );

  assert.equal(isolation.killOnExit, true);
  assert.equal(isolation.registerForCleanup, true);
  assert.match(isolation.buckIsolation, new RegExp(`${BINDING_A.slice(0, 24)}(?:\\.noindex)?$`));
  assert.deepEqual(isolation.isolationFlags, ["--isolation-dir", isolation.buckIsolation]);
  assert.match(source, /\$`buck2 --isolation-dir \$\{buckIsolation\} kill`/u);
  const runSource = await fsp.readFile(
    "viberoots/build-tools/tools/dev/dev-build/run-dev-build.ts",
    "utf8",
  );
  assert.match(
    runSource,
    /await withSharedBuckIsolationStartupLock\(\s*root,\s*activeIsolation\.baseBuckIsolation/u,
  );
  assert.match(runSource, /await iso\.killIsolationIfOwned\(\)\.catch/);
});
