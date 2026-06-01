import * as fsp from "node:fs/promises";
import YAML from "yaml";
import { getFlagBool, getFlagStr } from "../lib/cli";
import type { DeploymentTarget } from "./contract";
import { printDeployJson } from "./deploy-front-door";
import {
  assertSupportedPhase,
  runCloudProviderCapabilityHook,
  type CloudProviderCapabilityHookPhase,
} from "./cloud-control-provider-capability-hooks";
import type { AwsTopologyEvidence } from "./cloud-control-aws-topology-types";
import { validateSupabaseManagedPostgresProfile } from "./control-plane-supabase-postgres-validation";

export async function maybeRunProviderCapabilityHookForCli(opts: {
  deployment: DeploymentTarget;
}): Promise<boolean> {
  const capabilityId = getFlagStr("provider-capability", "").trim();
  if (!capabilityId) return false;
  const phase = selectedProviderCapabilityPhase();
  const evidence = await runCloudProviderCapabilityHook({
    capabilityId,
    phase,
    deploymentLabel: opts.deployment.label,
    ...(await providerInputs(capabilityId)),
  });
  printDeployJson(evidence);
  return true;
}

async function providerInputs(capabilityId: string) {
  const topology = await awsTopologyInput();
  if (capabilityId === "aws-ec2-control-plane-host") {
    if (!topology) {
      throw new Error(
        "aws-ec2-control-plane-host provider-capability requires --aws-topology-evidence",
      );
    }
    return {
      awsTopologyEvidence: topology,
      awsEc2Profile: await awsEc2ProfileInput(),
    };
  }
  if (
    (capabilityId === "aws-network-foundation" || capabilityId === "aws-s3-artifact-store") &&
    topology?.foundation
  ) {
    return { awsFoundationInspection: topology.foundation };
  }
  if (capabilityId !== "supabase-managed-postgres") return {};
  const profilePath = getFlagStr("supabase-postgres-profile", "").trim();
  if (!profilePath) {
    throw new Error(
      "supabase-managed-postgres provider-capability requires --supabase-postgres-profile",
    );
  }
  const profile = JSON.parse(await fsp.readFile(profilePath, "utf8"));
  const errors = validateSupabaseManagedPostgresProfile(profile);
  if (errors.length > 0) {
    throw new Error(`supabase-managed-postgres profile rejected: ${errors.join("; ")}`);
  }
  return { supabasePostgresProfile: profile };
}

async function awsTopologyInput(): Promise<AwsTopologyEvidence | undefined> {
  const topologyPath = getFlagStr("aws-topology-evidence", "").trim();
  if (!topologyPath) return undefined;
  return JSON.parse(await fsp.readFile(topologyPath, "utf8"));
}

async function awsEc2ProfileInput(): Promise<Record<string, unknown>> {
  const profilePath = getFlagStr("aws-ec2-profile", "").trim();
  if (!profilePath) {
    throw new Error("aws-ec2-control-plane-host provider-capability requires --aws-ec2-profile");
  }
  return YAML.parse(await fsp.readFile(profilePath, "utf8"));
}

function selectedProviderCapabilityPhase(): CloudProviderCapabilityHookPhase {
  const selected = [
    getFlagBool("preview") ? "preview" : "",
    getFlagBool("smoke") ? "smoke" : "",
    getFlagBool("record") ? "evidence" : "",
    getFlagBool("rollback") ? "rollback" : "",
  ].filter(Boolean);
  if (selected.length > 1) {
    throw new Error("provider-capability hook accepts exactly one phase flag");
  }
  const phase = selected[0] || getFlagStr("provider-capability-phase", "apply").trim();
  assertSupportedPhase(phase);
  return phase;
}
