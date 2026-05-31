#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import { evidence, IMAGE_BUILD_IDENTITY } from "./cloud-control-cutover-fixture";

const OPTIONS = {
  operation: "rollback" as const,
  expectedHostProfile: "aws-ec2",
  expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
  selectedCapabilities: [],
  maxAgeMinutes: 60,
};

test("operation evidence rejects malformed refs and digest drift", () => {
  const malformed = validateCloudControlCutover(
    evidence({
      rollback: {
        ...(evidence().rollback as Record<string, unknown>),
        providerLocks: { evidenceRef: "dashboard-note-without-type" },
      },
    }),
    OPTIONS,
  );
  assert.match(malformed.errors.join("\n"), /missing rollback providerLocks evidence/);

  const drift = validateCloudControlCutover(
    evidence({
      breakGlass: {
        ...(evidence().breakGlass as Record<string, unknown>),
        configDigest: "sha256:old-config",
      },
    }),
    { ...OPTIONS, operation: "break-glass" },
  );
  assert.match(drift.errors.join("\n"), /break-glass evidence configDigest does not match/);
});
