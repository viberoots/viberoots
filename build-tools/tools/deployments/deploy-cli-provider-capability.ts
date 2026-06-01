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
import {
  validateControlPlaneImagePublicationEvidence,
  type ControlPlaneImagePublicationEvidence,
} from "./control-plane-image-publication";
import type { ControlPlaneRegistryProfile } from "./control-plane-registry-profile";

export async function maybeRunProviderCapabilityHookForCli(opts: {
  deployment: DeploymentTarget;
}): Promise<boolean> {
  const capabilityId = getFlagStr("provider-capability", "").trim();
  if (!capabilityId) return false;
  const phase = selectedProviderCapabilityPhase();
  const evidence = await runProviderCapabilityHookForCli({
    capabilityId,
    phase,
    deploymentLabel: opts.deployment.label,
  });
  printDeployJson(evidence);
  return true;
}

export async function runProviderCapabilityHookForCli(opts: {
  capabilityId: string;
  phase: CloudProviderCapabilityHookPhase;
  deploymentLabel: string;
}) {
  return runCloudProviderCapabilityHook({
    capabilityId: opts.capabilityId,
    phase: opts.phase,
    deploymentLabel: opts.deploymentLabel,
    ...(await providerInputs(opts.capabilityId)),
  });
}

async function providerInputs(capabilityId: string) {
  const topology = await awsTopologyInput();
  if (capabilityId === "aws-ecr-control-plane-registry") {
    return {
      ...(topology ? { awsTopologyEvidence: topology } : {}),
      ...(await ecrInputs()),
    };
  }
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
  if (capabilityId === "supabase-privatelink-prerequisite") {
    return topology ? { awsTopologyEvidence: topology } : {};
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

async function ecrInputs() {
  const registryProfilePath = getFlagStr("registry-profile", "").trim();
  if (!registryProfilePath) {
    throw new Error(
      "aws-ecr-control-plane-registry provider-capability requires --registry-profile",
    );
  }
  const registryProfile = JSON.parse(
    await fsp.readFile(registryProfilePath, "utf8"),
  ) as ControlPlaneRegistryProfile;
  registryProfile.iac = {
    ...(registryProfile.iac || {}),
    ...(await ecrIacInputs()),
  };
  const publicationPath = getFlagStr("image-publication-evidence", "").trim();
  if (!publicationPath) {
    throw new Error(
      "aws-ecr-control-plane-registry provider-capability requires --image-publication-evidence",
    );
  }
  const imagePublication = (await readJson(
    publicationPath,
  )) as ControlPlaneImagePublicationEvidence;
  imagePublication.registryProfile = registryProfile;
  const errors = validateControlPlaneImagePublicationEvidence(
    imagePublication,
    imagePublication.image,
    imagePublication.imageBuildIdentity,
    { requireRegistryProfile: true, expectedRuntimeHostProfile: "aws-ec2" },
  );
  if (errors.length > 0) {
    throw new Error(`image publication evidence rejected: ${errors.join("; ")}`);
  }
  return { registryProfile, imagePublication };
}

async function ecrIacInputs() {
  return {
    ...(await optionalJsonFlag("ecr-opentofu-plan", "plan")),
    ...(await optionalJsonFlag("ecr-opentofu-apply", "apply")),
    ...(await optionalJsonFlag("ecr-readonly-evidence", "readOnly")),
  };
}

async function awsTopologyInput(): Promise<AwsTopologyEvidence | undefined> {
  const topologyPath = getFlagStr("aws-topology-evidence", "").trim();
  if (!topologyPath) return undefined;
  return readJson(topologyPath) as Promise<AwsTopologyEvidence>;
}

async function awsEc2ProfileInput(): Promise<Record<string, unknown>> {
  const profilePath = getFlagStr("aws-ec2-profile", "").trim();
  if (!profilePath) {
    throw new Error("aws-ec2-control-plane-host provider-capability requires --aws-ec2-profile");
  }
  return YAML.parse(await fsp.readFile(profilePath, "utf8"));
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

async function optionalJsonFlag(flag: string, key: string) {
  const filePath = getFlagStr(flag, "").trim();
  return filePath ? { [key]: await readJson(filePath) } : {};
}

export function selectedProviderCapabilityPhase(): CloudProviderCapabilityHookPhase {
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
