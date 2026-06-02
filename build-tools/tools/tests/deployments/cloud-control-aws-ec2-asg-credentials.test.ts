#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import YAML from "yaml";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { validateEc2AsgIacBundle } from "../../deployments/cloud-control-aws-ec2-asg-iac-evidence";
import { ec2HostProfileInput } from "./cloud-control-aws-ec2-host-profile.fixture";
import { asgIac, asgTopology } from "./cloud-control-aws-ec2-asg.fixture";

test("repo-owned ASG read-only command requires reviewed AWS credential provenance", () => {
  const readonly = readOnlyCommand();
  assert.equal(readonly.cwd, "profile-root");
  assert.ok(readonly.inputs.includes("$PROFILE_ROOT/ec2-asg-aws-credential-provenance.json"));
  assert.ok(readonly.outputs.includes("$PROFILE_ROOT/ec2-asg-readonly-caller-identity.json"));
  assert.match(readonly.command, /ec2-asg-aws-credential-provenance\.json/);
  assert.match(readonly.command, /aws sts get-caller-identity/);
  assert.match(readonly.command, /aws autoscaling describe-auto-scaling-groups/);
  assert.match(readonly.command, /aws ec2 describe-launch-template-versions/);
  assert.match(
    readonly.command,
    /process\.env\.PROFILE_ROOT \+ "\/ec2-asg-opentofu-apply\.out\.json"/,
  );
  assert.match(
    readonly.command,
    /_ec2_asg_clear_ambient_aws_env\(\) \{ unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_SECURITY_TOKEN AWS_PROFILE AWS_DEFAULT_PROFILE AWS_SHARED_CREDENTIALS_FILE AWS_CONFIG_FILE AWS_SDK_LOAD_CONFIG AWS_ENDPOINT_URL AWS_ENDPOINT_URL_STS AWS_ENDPOINT_URL_EC2 AWS_ENDPOINT_URL_AUTO_SCALING AWS_DEFAULT_REGION AWS_ROLE_ARN AWS_ROLE_SESSION_NAME AWS_WEB_IDENTITY_TOKEN_FILE AWS_CONTAINER_CREDENTIALS_RELATIVE_URI AWS_CONTAINER_CREDENTIALS_FULL_URI AWS_CONTAINER_AUTHORIZATION_TOKEN AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE/,
  );
  assert.doesNotMatch(readonly.command, /AWS_ENDPOINT_URL_AUTOSCALING/);
  assert.match(readonly.command, /AWS_EC2_METADATA_SERVICE_ENDPOINT/);
  assert.match(readonly.command, /AWS_METADATA_SERVICE_TIMEOUT/);
  assert.doesNotMatch(readonly.command, /\(\) \{;/);
  assert.match(
    readonly.command,
    /_ec2_asg_clear_ambient_aws_env; AWS_PROFILE="\$REVIEWED_PROFILE"; AWS_SHARED_CREDENTIALS_FILE="\$REVIEWED_SHARED_CREDENTIALS_FILE"; AWS_SDK_LOAD_CONFIG=1; AWS_EC2_METADATA_DISABLED=true; export AWS_PROFILE AWS_SHARED_CREDENTIALS_FILE AWS_SDK_LOAD_CONFIG AWS_EC2_METADATA_DISABLED/,
  );
  assert.match(
    readonly.command,
    /_ec2_asg_clear_ambient_aws_env; ASSUMED="\$\(AWS_PROFILE="\$SOURCE_PROFILE" AWS_SHARED_CREDENTIALS_FILE="\$REVIEWED_SHARED_CREDENTIALS_FILE" aws sts assume-role/,
  );
  assertScrubsEndpointBefore(readonly.command, "aws sts assume-role");
  assert.match(
    readonly.command,
    /export ASSUMED; _ec2_asg_clear_ambient_aws_env; AWS_ACCESS_KEY_ID="\$\(node -e 'const c=JSON\.parse\(process\.env\.ASSUMED\)\.Credentials; process\.stdout\.write\(c\.AccessKeyId \|\| ""\)'\)"/,
  );
  assertScrubsEndpointBefore(readonly.command, "aws sts get-caller-identity");
  assertScrubsEndpointBefore(readonly.command, "aws autoscaling describe-auto-scaling-groups", {
    requiredName: "AWS_ENDPOINT_URL_AUTO_SCALING",
  });
  assertScrubsEndpointBefore(readonly.command, "aws ec2 describe-launch-template-versions");
  assert.ok(readonly.command.includes('"instance-profile") test -n "$(node -e'));
  assert.doesNotMatch(
    readonly.command,
    /"file-backed-profile"\);|"assume-role"\);|"instance-profile"\);/,
  );
  assert.ok(
    readonly.command.includes(
      'process.stdout.write(c.instanceProfileArn || "")\')"; _ec2_asg_clear_ambient_aws_env; export AWS_EC2_METADATA_DISABLED=false',
    ),
  );
  assert.doesNotMatch(readonly.command, /create-auto-scaling-group|update-auto-scaling-group/);
});

test("repo-owned ASG read-only generated command parses as shell", () => {
  const readonly = readOnlyCommand();
  execFileSync("bash", ["-n"], { input: `#!/usr/bin/env bash\n${readonly.command}\n` });
});

test("repo-owned ASG evidence rejects unreviewed credential provenance", () => {
  const cases = [
    ["missing", { credentialProvenance: undefined }, /credential provenance/],
    ["ambient", { credentialProvenance: { mode: "ambient" } }, /ambient or unreviewed/],
    [
      "default profile",
      { credentialProvenance: { ...credential(), profileName: "default" } },
      /default profile/,
    ],
    [
      "wrong account",
      { credentialProvenance: { ...credential(), accountId: "999999999999" } },
      /credential accountId does not match/,
    ],
    [
      "wrong region",
      { credentialProvenance: { ...credential(), region: "us-west-2" } },
      /credential region does not match/,
    ],
    [
      "mismatched boundary",
      { credentialProvenance: { ...credential(), boundaryDigest: `sha256:${"0".repeat(64)}` } },
      /credential boundary does not match/,
    ],
  ] as const;
  for (const [label, readOnlyOverride, expected] of cases) {
    const iac = asgIac({
      readOnly: { ...asgIac().readOnly!, ...readOnlyOverride },
    });
    assert.match(validate(iac), expected, label);
  }
});

test("repo-owned ASG evidence rejects plan and apply credential boundary drift", () => {
  const iac = asgIac({
    apply: {
      ...asgIac().apply!,
      reviewedCredentialBoundary: { ...credential(), boundaryDigest: `sha256:${"1".repeat(64)}` },
    },
  });
  assert.match(validate(iac), /apply credential boundary does not match reviewed plan/);
});

function validate(iac: any) {
  return validateEc2AsgIacBundle({
    iac,
    phase: "evidence",
    topology: asgTopology() as any,
    profile,
    expectedMode: "repo-owned-asg",
  }).join("\n");
}

const profile = YAML.parse(
  renderCloudControlSetupBundle(
    ec2HostProfileInput({ ec2HostMode: "repo-owned-asg", awsTopology: asgTopology() as any }),
  ).files["aws-ec2-profile.yaml"]!,
);

function credential() {
  return asgIac().readOnly!.credentialProvenance as Record<string, unknown>;
}

function readOnlyCommand(): any {
  const bundle = renderCloudControlSetupBundle(
    ec2HostProfileInput({ ec2HostMode: "repo-owned-asg", awsTopology: asgTopology() as any }),
  );
  const commands = JSON.parse(bundle.files["commands.json"]!);
  const managed = commands.phases.find((phase: any) => phase.id === "managed-dependencies");
  return managed.commands.find((entry: any) => entry.id === "ec2-asg-readonly-evidence");
}

function assertScrubsEndpointBefore(
  command: string,
  marker: string,
  opts: { requiredName?: string } = {},
) {
  const markerIndex = command.indexOf(marker);
  assert.notEqual(markerIndex, -1, marker);
  const prefix = command.slice(0, markerIndex);
  const scrubIndex = prefix.lastIndexOf("_ec2_asg_clear_ambient_aws_env");
  assert.notEqual(scrubIndex, -1, marker);
  const scrubDefinition = prefix.slice(0, scrubIndex);
  assert.match(scrubDefinition, /AWS_ENDPOINT_URL/);
  if (opts.requiredName) assert.match(scrubDefinition, new RegExp(opts.requiredName));
}
