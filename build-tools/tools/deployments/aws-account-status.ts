import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  AWS_ACCOUNT_INPUTS_SCHEMA,
  AWS_ACCOUNT_STATUS_SCHEMA,
  PHASES,
  type AwsAccountConfig,
  type AwsAccountStatus,
  type Phase,
  type PhaseRecord,
} from "./aws-account-types";
import { writeEvidence } from "./aws-account-utils";

export async function writeStatusAndInputs(config: AwsAccountConfig, status: AwsAccountStatus) {
  await writeEvidence(path.join(config.evidenceDir, "inputs.json"), {
    schemaVersion: AWS_ACCOUNT_INPUTS_SCHEMA,
    ...stackConfigCompatibleInputs(config),
    inputSources: config.inputSources,
  });
  await writeEvidence(path.join(config.evidenceDir, "status.json"), status);
}

function stackConfigCompatibleInputs(config: AwsAccountConfig): Record<string, unknown> {
  const inputs: Record<string, unknown> = {
    stackName: config.stackName,
    region: config.region,
    domain: config.domain,
    service: config.service,
    authService: config.authService,
    privateDbService: config.privateDbService,
    serviceHost: config.serviceHost,
    authHost: config.authHost,
    privateDbHost: config.privateDbHost,
    evidenceDir: config.evidenceDir,
    stateBucketName: config.stateBucketName,
    stateLockTableName: config.stateLockTableName,
    backendStateKey: config.backendStateKey,
    awsAccountId: config.awsAccountId,
    awsOrganizationId: config.awsOrganizationId,
    expectedAwsRoleArn: config.expectedAwsRoleArn,
    supabaseOrgId: config.supabaseOrgId,
    supabaseProjectRef: config.supabaseProjectRef,
    supabaseRegion: config.supabaseRegion,
    supabaseAccessTokenEnv: config.supabaseAccessTokenEnv,
    supabaseApiBaseUrl: config.supabaseApiBaseUrl,
  };
  if (config.supabaseAccessToken?.ref) {
    inputs.supabaseAccessToken = {
      ref: config.supabaseAccessToken.ref,
      ...(config.supabaseAccessToken.category
        ? { category: config.supabaseAccessToken.category }
        : {}),
    };
  }
  return inputs;
}

export async function readStatus(config: AwsAccountConfig): Promise<AwsAccountStatus> {
  const raw = await fsp.readFile(path.join(config.evidenceDir, "status.json"), "utf8");
  return JSON.parse(raw) as AwsAccountStatus;
}

export function freshStatus(config: AwsAccountConfig, now: string): AwsAccountStatus {
  const phases = Object.fromEntries(
    PHASES.map((phase) => [phase, { state: "pending", message: "not run" }]),
  ) as Record<Phase, PhaseRecord>;
  return {
    schemaVersion: AWS_ACCOUNT_STATUS_SCHEMA,
    updatedAt: now,
    stackName: config.stackName,
    domain: config.domain,
    evidenceDir: config.evidenceDir,
    phases,
  };
}

export function nextPhase(status: AwsAccountStatus): Phase | undefined {
  return PHASES.find((phase) => status.phases[phase]?.state !== "passed");
}
