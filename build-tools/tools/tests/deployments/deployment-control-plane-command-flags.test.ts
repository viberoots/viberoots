#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { selectedControlPlaneCommand } from "../../deployments/deployment-control-plane-command";

test("provider-capability generated value flags do not become positional commands", () => {
  const original = process.argv;
  const originalGlobalArgv = (globalThis as any).argv;
  try {
    delete (globalThis as any).argv;
    process.argv = [
      "node",
      "deployment-control-plane",
      "provider-capability",
      "--deployment-id",
      "staging",
      "--provider-capability",
      "aws-ecr-control-plane-registry",
      "--ecr-opentofu-plan",
      "$PROFILE_ROOT/ecr-opentofu-plan.json",
      "--ecr-opentofu-apply",
      "$PROFILE_ROOT/ecr-opentofu-apply.json",
      "--ecr-readonly-evidence",
      "$PROFILE_ROOT/ecr-readonly-evidence.json",
      "--ec2-asg-opentofu-plan",
      "$PROFILE_ROOT/ec2-asg-opentofu-plan.json",
      "--supabase-privatelink-opentofu-plan",
      "$PROFILE_ROOT/supabase-privatelink-opentofu-plan.json",
      "--cloudflare-edge-evidence",
      "$PROFILE_ROOT/cloudflare-edge-evidence.json",
      "--vercel-operator-ui-evidence",
      "$PROFILE_ROOT/vercel-operator-ui-evidence.json",
      "--remote-build-worker-fleet-evidence",
      "$PROFILE_ROOT/remote-build-worker-fleet-evidence.json",
      "--aws-attic-cache-evidence",
      "$PROFILE_ROOT/aws-attic-cache-evidence.json",
    ];
    assert.equal(selectedControlPlaneCommand(), "provider-capability");
  } finally {
    process.argv = original;
    (globalThis as any).argv = originalGlobalArgv;
  }
});
