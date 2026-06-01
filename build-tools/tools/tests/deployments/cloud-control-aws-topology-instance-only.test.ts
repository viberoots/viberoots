#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAwsTopologyEvidence } from "../../deployments/cloud-control-aws-topology-validate";
import { publicAwsTopology } from "./cloud-control-cutover-fixture";

const opts = { expectedRegion: "us-east-1", maxAgeMinutes: 60 };

test("AWS topology schema accepts instance-only compute identity without launch template", () => {
  const base = publicAwsTopology() as any;
  assert.deepEqual(
    validateAwsTopologyEvidence(
      publicAwsTopology({
        compute: {
          ...base.compute,
          instanceId: "i-0abc1234",
          launchTemplateId: "",
          launchTemplateVersion: "",
        },
      }),
      opts,
    ),
    [],
  );
});
