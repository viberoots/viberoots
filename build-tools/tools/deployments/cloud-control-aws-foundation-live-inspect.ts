import { execFileSync } from "node:child_process";
import { awsFoundationDigest } from "./cloud-control-aws-foundation-credentials";
import { inspectLiveIngress } from "./cloud-control-aws-foundation-live-ingress";
import type { AwsFoundationProfile } from "./cloud-control-aws-foundation-types";

export function assertLiveAwsState(profile: AwsFoundationProfile, env: NodeJS.ProcessEnv): void {
  const regionArgs = ["--region", profile.region];
  const network = profile.network;
  const vpc = awsJson<{ Vpcs?: { VpcId?: string }[] }>(
    ["ec2", "describe-vpcs", "--vpc-ids", network.vpc.vpcId, ...regionArgs],
    env,
  );
  if (!vpc.Vpcs?.some((item) => item.VpcId === network.vpc.vpcId)) {
    throw new Error("live AWS foundation VPC inspection did not confirm selected VPC");
  }
  assertLiveSubnets(profile, env, regionArgs);
  const routes = awsJson<{ RouteTables?: { RouteTableId?: string }[] }>(
    ["ec2", "describe-route-tables", "--route-table-ids", ...network.routeTableIds, ...regionArgs],
    env,
  );
  assertIds(
    "route table",
    network.routeTableIds,
    routes.RouteTables?.map((item) => item.RouteTableId),
  );
  const groups = awsJson<{ SecurityGroups?: { GroupId?: string }[] }>(
    [
      "ec2",
      "describe-security-groups",
      "--group-ids",
      ...Object.values(network.securityGroupIds),
      ...regionArgs,
    ],
    env,
  );
  assertIds(
    "security group",
    Object.values(network.securityGroupIds),
    groups.SecurityGroups?.map((item) => item.GroupId),
  );
  inspectLiveS3Endpoint(profile, env, regionArgs);
  if (profile.artifactStore.backend === "aws-s3" && profile.artifactStore.bucket) {
    inspectLiveBucket(profile, env);
  }
  inspectLiveIngress(profile, env, regionArgs);
  const policyDigests = new Set(
    Object.values(profile.iam.roles).flatMap((role) => inspectLiveRole(role, env)),
  );
  for (const policy of profile.iam.policies) {
    if (!policyDigests.has(policy.digest)) {
      throw new Error(`live AWS foundation IAM policy ${policy.name} digest was not inspected`);
    }
  }
}

export function awsJson<T>(args: string[], env: NodeJS.ProcessEnv): T {
  const raw = execFileSync("aws", args, {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(raw) as T;
}

function assertLiveSubnets(
  profile: AwsFoundationProfile,
  env: NodeJS.ProcessEnv,
  regionArgs: string[],
): void {
  const subnetIds = profile.network.privateSubnets.map((subnet) => subnet.id);
  const payload = awsJson<{ Subnets?: { VpcId?: string; MapPublicIpOnLaunch?: boolean }[] }>(
    ["ec2", "describe-subnets", "--subnet-ids", ...subnetIds, ...regionArgs],
    env,
  );
  for (const subnet of payload.Subnets || []) {
    if (subnet.VpcId !== profile.network.vpc.vpcId || subnet.MapPublicIpOnLaunch === true) {
      throw new Error("live AWS foundation subnet inspection rejected selected private subnet");
    }
  }
}

function inspectLiveS3Endpoint(
  profile: AwsFoundationProfile,
  env: NodeJS.ProcessEnv,
  regionArgs: string[],
): void {
  const endpoint = awsJson<{ VpcEndpoints?: Record<string, unknown>[] }>(
    [
      "ec2",
      "describe-vpc-endpoints",
      "--vpc-endpoint-ids",
      profile.network.s3VpcEndpoint.endpointId,
      ...regionArgs,
    ],
    env,
  ).VpcEndpoints?.[0];
  if (
    !endpoint ||
    endpoint.VpcId !== profile.network.vpc.vpcId ||
    endpoint.VpcEndpointType !== profile.network.s3VpcEndpoint.type
  )
    throw new Error("live AWS foundation S3 endpoint identity does not match profile");
  assertIds(
    "S3 endpoint route table",
    profile.network.s3VpcEndpoint.routeTableIds,
    endpoint.RouteTableIds as string[],
  );
  assertDigest(
    "S3 endpoint policy",
    profile.network.s3VpcEndpoint.endpointPolicyDigest,
    endpoint.PolicyDocument,
  );
}

function inspectLiveBucket(profile: AwsFoundationProfile, env: NodeJS.ProcessEnv): void {
  const store = profile.artifactStore;
  const bucket = store.bucket || "";
  const block = awsJson<{ PublicAccessBlockConfiguration?: Record<string, boolean> }>(
    ["s3api", "get-public-access-block", "--bucket", bucket],
    env,
  ).PublicAccessBlockConfiguration;
  if (!store.publicAccessBlock || !block || Object.values(block).some((value) => value !== true)) {
    throw new Error("live AWS foundation bucket public access block was not confirmed");
  }
  const versioning = awsJson<{ Status?: string }>(
    ["s3api", "get-bucket-versioning", "--bucket", bucket],
    env,
  );
  if (!store.versioning || versioning.Status !== "Enabled")
    throw new Error("live bucket versioning is not enabled");
  const lifecycle = awsJson<{ Rules?: unknown[] }>(
    ["s3api", "get-bucket-lifecycle-configuration", "--bucket", bucket],
    env,
  );
  if (!store.lifecycle || !lifecycle.Rules?.length)
    throw new Error("live bucket lifecycle evidence is missing");
  awsJson(["s3api", "get-bucket-encryption", "--bucket", bucket], env);
  const policy = parseJsonish(
    awsJson<{ Policy?: string }>(["s3api", "get-bucket-policy", "--bucket", bucket], env).Policy,
  );
  assertDigest("artifact bucket policy", store.bucketPolicyDigest, policy);
  const immutable = immutableStatements(policy, store.prefix);
  if (!store.immutablePrefix || immutable.length === 0)
    throw new Error("live bucket immutable prefix policy is missing");
  assertDigest("artifact immutable prefix policy", store.immutablePrefixPolicyDigest, immutable);
  const objectLock = awsJson<{ ObjectLockConfiguration?: { ObjectLockEnabled?: string } }>(
    ["s3api", "get-object-lock-configuration", "--bucket", bucket],
    env,
  );
  if (
    store.retention === "object-lock" &&
    objectLock.ObjectLockConfiguration?.ObjectLockEnabled !== "Enabled"
  ) {
    throw new Error("live bucket object-lock retention is not enabled");
  }
}

function inspectLiveRole(roleArn: string, env: NodeJS.ProcessEnv): string[] {
  const roleName = roleArn.split("/").pop();
  if (!roleName) throw new Error("live AWS foundation IAM inspection missing role name");
  awsJson(["iam", "get-role", "--role-name", roleName], env);
  const attached =
    awsJson<{ AttachedPolicies?: { PolicyArn?: string }[] }>(
      ["iam", "list-attached-role-policies", "--role-name", roleName],
      env,
    ).AttachedPolicies || [];
  return attached.flatMap((policy) =>
    policy.PolicyArn ? [inspectLivePolicy(policy.PolicyArn, env)] : [],
  );
}

function inspectLivePolicy(policyArn: string, env: NodeJS.ProcessEnv): string {
  const policy = awsJson<{ Policy?: { DefaultVersionId?: string } }>(
    ["iam", "get-policy", "--policy-arn", policyArn],
    env,
  );
  const version = awsJson<{ PolicyVersion?: { Document?: unknown } }>(
    [
      "iam",
      "get-policy-version",
      "--policy-arn",
      policyArn,
      "--version-id",
      policy.Policy?.DefaultVersionId || "",
    ],
    env,
  );
  const document = parseJsonish(version.PolicyVersion?.Document);
  for (const action of policyActions(document)) {
    if (action.includes("*"))
      throw new Error(`live AWS foundation IAM policy ${policyArn} is over-broad`);
  }
  return awsFoundationDigest(document);
}

function assertIds(label: string, expected: string[], actual: (string | undefined)[] = []): void {
  for (const id of expected)
    if (!actual.includes(id)) throw new Error(`live AWS foundation missing ${label} ${id}`);
}

function assertDigest(label: string, expected: string | undefined, value: unknown): void {
  if (!expected?.startsWith("sha256:") || awsFoundationDigest(parseJsonish(value)) !== expected) {
    throw new Error(`live AWS foundation ${label} digest does not match inspected AWS state`);
  }
}

function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function immutableStatements(policy: unknown, prefix: string): unknown[] {
  const statements = (policy as { Statement?: unknown[] })?.Statement || [];
  return statements.filter((statement) => {
    const text = JSON.stringify(statement);
    return text.includes("Deny") && text.includes("DeleteObject") && text.includes(prefix);
  });
}

function policyActions(policy: unknown): string[] {
  const statements = (policy as { Statement?: Record<string, unknown>[] })?.Statement || [];
  return statements
    .flatMap((statement) =>
      Array.isArray(statement.Action) ? statement.Action : [statement.Action],
    )
    .filter((action): action is string => typeof action === "string");
}
