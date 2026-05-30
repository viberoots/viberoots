import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { awsFoundationLiveEnv } from "./cloud-control-aws-foundation-credentials";
import { assertLiveAwsState, awsJson } from "./cloud-control-aws-foundation-live-inspect";
import { awsFoundationProfileFromInspection } from "./cloud-control-aws-foundation-render";
import type { AwsFoundationProfile } from "./cloud-control-aws-foundation-types";

const SERVICE_QUOTA_CODES: Record<string, string> = {
  "vpc-endpoints": "vpc",
  "load-balancers": "elasticloadbalancing",
  "vpc-lattice": "vpc-lattice",
  ec2: "ec2",
  ebs: "ebs",
  ecr: "ecr",
  kms: "kms",
  cloudwatch: "cloudwatch",
};

export function inspectAwsFoundationProfile(): AwsFoundationProfile {
  const filePath = process.env.VBR_AWS_FOUNDATION_INSPECTION_FILE?.trim();
  if (filePath) return readInspectionFile(filePath);
  if (process.env.VBR_AWS_FOUNDATION_LIVE === "1") return inspectLiveAws();
  throw new Error(
    "AWS foundation hooks require VBR_AWS_FOUNDATION_INSPECTION_FILE or VBR_AWS_FOUNDATION_LIVE=1",
  );
}

function readInspectionFile(filePath: string): AwsFoundationProfile {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as { foundation?: unknown };
  const inspection = payload.foundation ?? payload;
  return awsFoundationProfileFromInspection(inspection as any);
}

function inspectLiveAws(): AwsFoundationProfile {
  const credentials = awsFoundationLiveEnv();
  const filePath = process.env.VBR_AWS_FOUNDATION_LIVE_INPUT_FILE?.trim();
  if (!filePath) {
    throw new Error("live AWS foundation inspection requires VBR_AWS_FOUNDATION_LIVE_INPUT_FILE");
  }
  const inspected = readInspectionFile(filePath);
  const identity = awsJson<{ Account?: string }>(
    ["sts", "get-caller-identity", "--region", inspected.region],
    credentials.env,
  );
  if (inspected.accountId !== identity.Account) {
    throw new Error("live AWS foundation inspection account does not match STS identity");
  }
  assertLiveAwsState(inspected, credentials.env);
  assertLivePreflight(inspected, credentials.env);
  assertLiveDrift(inspected, credentials.env);
  return { ...inspected, source: "aws-provider-inspection" };
}

function assertLivePreflight(profile: AwsFoundationProfile, env: NodeJS.ProcessEnv): void {
  for (const quota of profile.preflight.quotas) {
    const live = awsJson<{ Quotas?: { Value?: number }[] }>(
      [
        "service-quotas",
        "list-service-quotas",
        "--service-code",
        serviceQuotaCode(quota.service),
        "--region",
        profile.region,
      ],
      env,
    );
    const available = Math.max(...(live.Quotas || []).map((item) => Number(item.Value || 0)));
    if (!Number.isFinite(available) || available < quota.required || quota.available > available) {
      throw new Error(`live AWS foundation quota ${quota.service} lacks required headroom`);
    }
  }
  if (!profile.preflight.costEstimate.approvedRef) {
    throw new Error("live AWS foundation cost evidence missing approval reference");
  }
}

function assertLiveDrift(profile: AwsFoundationProfile, env: NodeJS.ProcessEnv): void {
  const cwd = process.env.VBR_AWS_FOUNDATION_TOFU_DIR?.trim();
  if (!cwd) return;
  const backendConfig =
    process.env.VBR_AWS_FOUNDATION_BACKEND_CONFIG?.trim() || path.join(cwd, "backend.hcl");
  if (!fs.existsSync(backendConfig))
    throw new Error("live AWS foundation drift requires backend config");
  execFileSync("tofu", ["init", "-input=false", `-backend-config=${backendConfig}`], {
    cwd,
    encoding: "utf8",
    env,
  });
  const workspace = process.env.VBR_AWS_FOUNDATION_WORKSPACE?.trim() || profile.state.workspace;
  execFileSync("tofu", ["workspace", "select", workspace], { cwd, encoding: "utf8", env });
  const result = execFileSync("tofu", ["plan", "-detailed-exitcode", "-input=false"], {
    cwd,
    env,
    encoding: "utf8",
  });
  if (!profile.state.drift.diffDigest.startsWith("sha256:") || !result) {
    throw new Error("live AWS foundation drift/state evidence is missing");
  }
}

function serviceQuotaCode(service: string): string {
  return SERVICE_QUOTA_CODES[service] || service;
}
