#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { validateEc2AsgIacBundle } from "../../deployments/cloud-control-aws-ec2-asg-iac-evidence";
import { ec2HostProfileInput } from "./cloud-control-aws-ec2-host-profile.fixture";
import { asgIac, asgTopology } from "./cloud-control-aws-ec2-asg.fixture";

test("repo-owned ASG IaC evidence rejects user-data path and base64 drift", () => {
  const cases = [
    ["preview", "plan", "userDataPath", ""],
    ["preview", "plan", "userDataBase64", ""],
    ["apply", "apply", "userDataPath", "$PROFILE_ROOT/other-user-data.sh"],
    ["apply", "apply", "userDataBase64", Buffer.from("other").toString("base64")],
    ["evidence", "readOnly", "userDataPath", "$PROFILE_ROOT/stale-user-data.sh"],
    ["evidence", "readOnly", "userDataBase64", Buffer.from("stale").toString("base64")],
  ] as const;
  for (const [phase, key, field, value] of cases) {
    assert.match(
      errorsFor({ ...asgIac(), [key]: mergeExpected(asgIac()[key]!, field, value) }, phase),
      new RegExp(`${field} does not match`),
      `${key} ${field}`,
    );
  }
});

test("repo-owned ASG IaC evidence rejects user-data transition disagreement", () => {
  assert.match(
    errorsFor(
      {
        ...asgIac(),
        apply: mergeExpected(asgIac().apply!, "userDataPath", "$PROFILE_ROOT/apply-only.sh"),
      },
      "apply",
    ),
    /userDataPath does not match plan evidence/,
  );
  assert.match(
    errorsFor(
      {
        ...asgIac(),
        readOnly: mergeExpected(
          asgIac().readOnly!,
          "userDataBase64",
          Buffer.from("x").toString("base64"),
        ),
      },
      "evidence",
    ),
    /userDataBase64 does not match apply evidence/,
  );
});

function errorsFor(iac: ReturnType<typeof asgIac>, phase: string) {
  return validateEc2AsgIacBundle({
    iac,
    phase,
    topology: asgTopology() as any,
    profile: YAML.parse(
      renderCloudControlSetupBundle(
        ec2HostProfileInput({ ec2HostMode: "repo-owned-asg", awsTopology: asgTopology() as any }),
      ).files["aws-ec2-profile.yaml"]!,
    ),
    expectedMode: "repo-owned-asg",
  }).join("\n");
}

function mergeExpected(record: Record<string, any>, field: string, value: string) {
  return { ...record, expected: { ...(record.expected || {}), [field]: value } };
}
