#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import YAML from "yaml";
import { cutoverCommands } from "../../deployments/cloud-control-runbook-cutover";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { serviceNetworkAssociationEvidence } from "./cloud-control-supabase-privatelink.fixture";
import { setupInput } from "./control-plane-managed-dependencies-runtime-path.fixture";
import { runInScratchTemp } from "../lib/test-helpers";

const execFileAsync = promisify(execFile);

test("AWS setup profile renders runtime-path expectations and runbook source-host proof", () => {
  const bundle = renderCloudControlSetupBundle(setupInput());
  const profile = YAML.parse(bundle.files["managed-dependencies.profile.yaml"]!);
  assert.equal(profile.runtimePath.expectedHostProfile, "aws-ec2");
  assert.equal(profile.runtimePath.databaseConnectivityMode, "privatelink");
  assert.equal(profile.runtimePath.expectedSupabaseProjectRef, "project-review");
  assert.equal(profile.runtimePath.expectedSupabaseRegion, "us-east-1");
  assert.equal(profile.runtimePath.expectedPrivateLinkEndpointId, "vpce-privatelink123");
  assert.equal(profile.runtimePath.expectedS3VpcEndpointId, "vpce-123");
  assert.equal(profile.artifactStore.provider, "aws-s3");
  const commands = JSON.parse(bundle.files["commands.json"]!);
  const managed = runbookCommand(commands, "database").command;
  assert.match(managed, /source-host-identity/);
  assert.match(managed, /host-profile "\$RUNTIME_HOST_PROFILE"/);
  assert.match(managed, /aws-region "\$SOURCE_AWS_REGION"/);
  assert.match(managed, /supabase-project-ref 'project-review'/);
  assert.match(managed, /supabase-region 'us-east-1'/);
  assert.match(managed, /privatelink-endpoint-id 'vpce-privatelink123'/);
  assert.match(managed, /s3-vpc-endpoint-id 'vpce-123'/);
  assert.doesNotMatch(managed, /MANAGED_DEPENDENCY_PRIVATELINK_ENDPOINT_ID/);
  assert.doesNotMatch(managed, /MANAGED_DEPENDENCY_S3_VPC_ENDPOINT_ID/);
  assert.doesNotMatch(managed, /MANAGED_DEPENDENCY_SUPABASE_/);
  assert.match(managed, /latest\/api\/token/);
  assert.match(managed, /x-aws-ec2-metadata-token-ttl-seconds/);
  assert.match(managed, /x-aws-ec2-metadata-token: \$IMDS_TOKEN/);
  assert.doesNotMatch(managed, /meta-data\/instance-id 2>\/dev\/null \|\| true/);
  assert.doesNotMatch(managed, /meta-data\/placement\/region 2>\/dev\/null \|\| true/);
});

test("AWS setup runbook fails closed when IMDSv2 token acquisition fails", async () => {
  await runInScratchTemp("cloud-control-imdsv2-token-fail", async (tmp) => {
    const command = runbookCommand(
      JSON.parse(renderCloudControlSetupBundle(setupInput()).files["commands.json"]!),
      "database",
    ).command;
    const bin = path.join(tmp, "bin");
    await fsp.mkdir(bin);
    await fsp.writeFile(path.join(tmp, "commands.json"), "{}");
    await fsp.writeFile(path.join(bin, "curl"), "#!/usr/bin/env bash\nexit 7\n");
    await fsp.writeFile(
      path.join(bin, "deployment-control-plane"),
      "#!/usr/bin/env bash\necho should-not-run >&2\nexit 99\n",
    );
    await fsp.chmod(path.join(bin, "curl"), 0o755);
    await fsp.chmod(path.join(bin, "deployment-control-plane"), 0o755);
    await assert.rejects(
      () => execFileAsync("bash", ["-c", command], { cwd: tmp, env: pathEnv(bin) }),
      (error: any) => {
        assert.notEqual(error.code, 99);
        assert.doesNotMatch(`${error.stdout}${error.stderr}`, /should-not-run/);
        return true;
      },
    );
  });
});

test("AWS setup runbook executes IMDSv2 metadata fetches before managed validation", async () => {
  await runInScratchTemp("cloud-control-imdsv2-exec", async (tmp) => {
    const command = runbookCommand(
      JSON.parse(renderCloudControlSetupBundle(setupInput()).files["commands.json"]!),
      "database",
    ).command;
    const bin = path.join(tmp, "bin");
    const seen = path.join(tmp, "seen.log");
    await fsp.mkdir(bin);
    await fsp.writeFile(path.join(tmp, "commands.json"), "{}");
    await fsp.writeFile(path.join(bin, "curl"), fakeCurlScript(seen));
    await fsp.writeFile(path.join(bin, "deployment-control-plane"), fakeControlPlaneScript(seen));
    await fsp.chmod(path.join(bin, "curl"), 0o755);
    await fsp.chmod(path.join(bin, "deployment-control-plane"), 0o755);
    await execFileAsync("bash", ["-c", command], { cwd: tmp, env: pathEnv(bin) });
    const log = await fsp.readFile(seen, "utf8");
    assert.match(log, /PUT token/);
    assert.match(log, /token-header instance-id/);
    assert.match(log, /token-header region/);
    assert.match(log, /managed i-0abc1234 aws-ec2 us-west-2/);
  });
});

test("AWS EC2 cutover expected region comes from topology instead of artifact region", () => {
  const input = setupInput();
  input.artifactRegion = "us-west-2";
  const commands = JSON.parse(renderCloudControlSetupBundle(input).files["commands.json"]!);
  const command = runbookCommand(commands, "cutover-validate").command;
  assert.match(command, /--expected-region us-east-1/);
  assert.doesNotMatch(command, /--expected-region us-west-2/);
});

test("non-EC2 cutover expected region keeps artifact-region fallback", () => {
  const input = setupInput();
  input.mode = "compose-podman";
  input.artifactRegion = "us-east-2";
  input.awsTopology = undefined;
  const command = cutoverCommands(input).find((entry) => entry.id === "cutover-validate")!.command;
  assert.match(command, /--expected-region us-east-2/);
});

test("AWS setup runbook surfaces PrivateLink operator evidence actions from bundle root", () => {
  const commands = JSON.parse(renderCloudControlSetupBundle(setupInput()).files["commands.json"]!);
  const managedPhase = commands.phases.find((phase: any) => phase.id === "managed-dependencies");
  const ids = managedPhase.commands.map((command: any) => command.id);
  assert.equal(ids[0], "supabase-managed-postgres-evidence");
  const privateLinkIds = ids.filter((id: string) => id.startsWith("supabase-privatelink-"));
  assert.deepEqual(privateLinkIds, [
    "supabase-privatelink-support-initiation",
    "supabase-privatelink-ram-acceptance",
    "supabase-privatelink-vpc-lattice",
    "supabase-privatelink-private-dns",
    "supabase-privatelink-tcp-5432-sg",
    "supabase-privatelink-private-psql",
  ]);
  for (const id of privateLinkIds) {
    const action = runbookCommand(commands, id);
    assert.equal(action.cwd, "profile-root");
    assert.equal(action.actionType, "operator-evidence");
    assert.match(action.evidenceGuidance, /evidence/i);
    assert.match(action.command, /PROFILE_ROOT="\$\{PROFILE_ROOT:-\$\(pwd\)\}"/);
    assert.match(action.command, /test -f "\$PROFILE_ROOT\/supabase-privatelink-/);
    assert.doesNotMatch(action.command, /--out/);
  }
  assert.match(managedPhase.residualManualActions.join("\n"), /PrivateLink operator-evidence/);
  assert.match(managedPhase.evidenceInputs.join("\n"), /supabase-privatelink-ram-acceptance\.json/);
});

test("AWS setup runbook names the VPC Lattice service-network variant", () => {
  const input = setupInput();
  input.awsTopology = {
    ...input.awsTopology,
    database: { mode: "privatelink", privatelink: serviceNetworkAssociationEvidence() },
  } as any;
  const commands = JSON.parse(renderCloudControlSetupBundle(input).files["commands.json"]!);
  assert.match(
    runbookCommand(commands, "supabase-privatelink-vpc-lattice").evidenceGuidance,
    /service-network association/,
  );
});

function runbookCommand(commands: any, id: string) {
  const found = commands.phases
    .flatMap((phase: any) => phase.commands)
    .find((command: any) => command.id === id);
  if (!found) throw new Error(`missing runbook command ${id}`);
  return found;
}

function pathEnv(bin: string): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${bin}:${process.env.PATH || ""}` };
}

function fakeCurlScript(seen: string): string {
  return `#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"/latest/api/token"* ]]; then echo "PUT token" >> ${shellQuote(seen)}; echo token-123; exit 0; fi
if [[ "$args" != *"x-aws-ec2-metadata-token: token-123"* ]]; then echo "missing token" >&2; exit 8; fi
if [[ "$args" == *"/latest/meta-data/instance-id"* ]]; then echo "token-header instance-id" >> ${shellQuote(seen)}; echo i-0abc1234; exit 0; fi
if [[ "$args" == *"/latest/meta-data/placement/region"* ]]; then echo "token-header region" >> ${shellQuote(seen)}; echo us-west-2; exit 0; fi
exit 9
`;
}

function fakeControlPlaneScript(seen: string): string {
  return `#!/usr/bin/env bash
identity=""
kind=""
region=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --source-host-identity) identity="$2"; shift 2 ;;
    --source-host-kind) kind="$2"; shift 2 ;;
    --aws-region) region="$2"; shift 2 ;;
    *) shift ;;
  esac
done
echo "managed $identity $kind $region" >> ${shellQuote(seen)}
`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
