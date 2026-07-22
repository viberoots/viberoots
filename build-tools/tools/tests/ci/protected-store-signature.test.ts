#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { REVIEWED_EVIDENCE_PUBLIC_KEY } from "../../lib/artifact-nix-policy";
import {
  assertEvidenceStoreLocatorMatchesRegistry,
  assertReviewedEvidenceStoreUri,
} from "../../lib/protected-reproducibility-aggregate";
import {
  ensureProtectedStorePath,
  protectedStoreEnsureArgs,
  protectedStoreRoot,
  protectedStoreSignatureVerificationArgs,
  signAndVerifyProtectedStore,
  signAndVerifyProtectedStoreClosure,
  verifyProtectedStoreClosureSignature,
  verifyProtectedStoreSignature,
} from "../../lib/protected-store-signature";
import { runInTemp } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const root = `/nix/store/${"a".repeat(32)}-aggregate`;

test("protected evidence verification uses only the dedicated reviewed key", async () => {
  const calls: string[][] = [];
  const verified = await verifyProtectedStoreSignature(`${root}/aggregate.json`, async (args) => {
    calls.push(args);
    return {};
  });
  assert.equal(verified, root);
  assert.deepEqual(calls, [
    [
      "store",
      "verify",
      "--sigs-needed",
      "1",
      "--option",
      "trusted-public-keys",
      REVIEWED_EVIDENCE_PUBLIC_KEY,
      root,
    ],
  ]);
  assert.equal(calls[0]?.includes("--no-trust"), false);
});

test("fresh workers ensure the exact protected root before verification", async () => {
  const calls: string[][] = [];
  assert.equal(
    await ensureProtectedStorePath(`${root}/aggregate.json`, async (args) => {
      calls.push(args);
      return {};
    }),
    root,
  );
  assert.deepEqual(calls, [["store", "ensure-path", root]]);
  assert.deepEqual(protectedStoreEnsureArgs(root), calls[0]);
});

test("protected aggregates accept only signed-registry credential-free S3 stores", () => {
  assert.equal(
    assertReviewedEvidenceStoreUri("s3://reviewed-evidence/reproducibility"),
    "s3://reviewed-evidence/reproducibility",
  );
  assert.throws(
    () => assertReviewedEvidenceStoreUri("s3://user:secret@reviewed-evidence/reproducibility"),
    /credential-free signed S3/,
  );
  assert.throws(
    () => assertReviewedEvidenceStoreUri("https://cache.example.com/reproducibility"),
    /credential-free signed S3/,
  );
  assert.equal(
    assertEvidenceStoreLocatorMatchesRegistry(
      "s3://reviewed-evidence/reproducibility",
      "s3://reviewed-evidence/reproducibility",
    ),
    "s3://reviewed-evidence/reproducibility",
  );
  assert.throws(
    () =>
      assertEvidenceStoreLocatorMatchesRegistry(
        "s3://candidate/reproducibility",
        "s3://signed/reproducibility",
      ),
    /does not match the signed registry authority/,
  );
});

test("fresh aggregate ingress copies then verifies aggregate and registry before locator trust", async () => {
  const source = await fs.readFile(
    viberootsSourcePath("build-tools/tools/lib/protected-reproducibility-aggregate.ts"),
    "utf8",
  );
  const aggregateCopy = source.indexOf('runNix(["copy", "--from", candidateStoreUri');
  const aggregateVerify = source.indexOf("verifyProtectedStoreSignature(file");
  const aggregateRead = source.indexOf("fs.readFile(file");
  const registryCopy = source.indexOf(
    'runNix(["copy", "--from", candidateStoreUri, protectedStoreRoot(registryStorePath)',
  );
  const registryVerify = source.indexOf("verifyProtectedStoreSignature(registryStorePath");
  const registryRead = source.indexOf("fs.readFile(registryStorePath");
  assert.ok(
    aggregateCopy >= 0 && aggregateCopy < aggregateVerify && aggregateVerify < aggregateRead,
  );
  assert.ok(
    registryCopy > aggregateRead && registryCopy < registryVerify && registryVerify < registryRead,
  );
  assert.ok(source.lastIndexOf("assertEvidenceStoreLocatorMatchesRegistry") > registryRead);
});

test("protected evidence verification rejects non-store and nested paths", () => {
  assert.throws(() => protectedStoreRoot("/tmp/aggregate.json"), /exact Nix store root/);
  assert.throws(
    () => protectedStoreSignatureVerificationArgs(`${root}/nested/aggregate.json`),
    /exact Nix store root/,
  );
});

test("protected evidence verification propagates signature failures", async () => {
  await assert.rejects(
    verifyProtectedStoreSignature(root, async () => {
      throw new Error("signature verification failed");
    }),
    /signature verification failed/,
  );
});

test("protected evidence signing accepts only an external owner-mode-0600 key", async () => {
  await runInTemp("protected-evidence-signing", async (tmp) => {
    const key = path.join(tmp, "evidence.sec");
    await fs.writeFile(key, "not-inspected-by-the-helper\n", { mode: 0o600 });
    const calls: string[][] = [];
    assert.equal(
      await signAndVerifyProtectedStore(root, key, async (args) => {
        calls.push(args);
        return {};
      }),
      root,
    );
    assert.deepEqual(calls[0], ["store", "sign", "--key-file", key, root]);
    assert.deepEqual(calls[1], protectedStoreSignatureVerificationArgs(root));

    await fs.chmod(key, 0o644);
    await assert.rejects(
      signAndVerifyProtectedStore(root, key, async () => ({})),
      /owner-only mode 0600/,
    );
    await fs.chmod(key, 0o600);
    const link = path.join(tmp, "evidence-link.sec");
    await fs.symlink(key, link);
    await assert.rejects(
      signAndVerifyProtectedStore(root, link, async () => ({})),
      /nofollow regular file/,
    );
  });
});

test("artifact output signing covers and verifies the complete referenced closure", async () => {
  await runInTemp("protected-output-signing", async (tmp) => {
    const key = path.join(tmp, "evidence.sec");
    await fs.writeFile(key, "not-inspected-by-the-helper\n", { mode: 0o600 });
    const calls: string[][] = [];
    await signAndVerifyProtectedStoreClosure(root, key, async (args) => {
      calls.push(args);
      return {};
    });
    assert.deepEqual(calls[0], ["store", "sign", "--recursive", "--key-file", key, root]);
    assert.equal(calls[1]?.includes("--recursive"), true);
    const verifyCalls: string[][] = [];
    await verifyProtectedStoreClosureSignature(root, async (args) => {
      verifyCalls.push(args);
      return {};
    });
    assert.equal(verifyCalls[0]?.includes("--recursive"), true);
  });
});
