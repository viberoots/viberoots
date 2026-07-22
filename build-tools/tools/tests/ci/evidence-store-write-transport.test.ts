import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertEvidenceStoreAwsCredentialsFile,
  evidenceStoreWriteEnvironment,
} from "../../ci/evidence-store-write-transport";

test("evidence-store write capability is an owner-only file with no endpoint authority", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-store-write-"));
  const credentials = path.join(root, "aws-credentials");
  const storeUri = "s3://reviewed-evidence/reproducibility";
  fs.writeFileSync(credentials, "[default]\naws_access_key_id = fixture\n", { mode: 0o600 });
  assert.equal(assertEvidenceStoreAwsCredentialsFile(credentials, storeUri), credentials);
  const env = evidenceStoreWriteEnvironment(
    {
      PATH: "/nix/store/tools/bin",
      AWS_EC2_METADATA_DISABLED: "false",
      AWS_SECRET_ACCESS_KEY: "ambient-secret",
    },
    credentials,
    storeUri,
  );
  assert.equal(env.AWS_SHARED_CREDENTIALS_FILE, credentials);
  assert.equal(env.AWS_EC2_METADATA_DISABLED, "true");
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  fs.chmodSync(credentials, 0o644);
  assert.throws(
    () => assertEvidenceStoreAwsCredentialsFile(credentials, storeUri),
    /owner-controlled mode-0600/,
  );
  fs.chmodSync(credentials, 0o600);
  const link = path.join(root, "credentials-link");
  fs.symlinkSync(credentials, link);
  assert.throws(
    () => assertEvidenceStoreAwsCredentialsFile(link, storeUri),
    /nofollow mode-0600 file/,
  );
  fs.rmSync(root, { recursive: true });
});

test("evidence-store credentials accept only the signed registry's S3 authority", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-store-write-invalid-"));
  const credentials = path.join(root, "aws-credentials");
  fs.writeFileSync(credentials, "[default]\n", { mode: 0o600 });
  for (const storeUri of [
    "https://cache.example.com/reproducibility",
    "s3://user:secret@reviewed-evidence/reproducibility",
    "s3://reviewed-evidence/reproducibility?region=host-selected",
  ]) {
    assert.throws(
      () => assertEvidenceStoreAwsCredentialsFile(credentials, storeUri),
      /credential-free S3 store authority/,
    );
  }
  fs.rmSync(root, { recursive: true });
});
