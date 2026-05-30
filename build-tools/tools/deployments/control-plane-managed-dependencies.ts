#!/usr/bin/env zx-wrapper
import { getFlagBool, getFlagStr } from "../lib/cli";
import {
  loadManagedDependencyProfile,
  parseManagedRuntimeSourceHostKind,
  parseManagedDependencyProfile,
} from "./control-plane-managed-dependency-profiles";
import type { ManagedRuntimePathFacts } from "./control-plane-managed-dependency-types";
import { validateManagedDependencyProfile } from "./control-plane-managed-dependency-validation";
import { redactConfigDiagnostic } from "./control-plane-runtime-config";

export async function runControlPlaneManagedDependenciesCli() {
  const profilePath = getFlagStr("profile");
  const credentialDirectory = getFlagStr("credential-directory");
  if (!profilePath || !credentialDirectory) {
    throw new Error("managed dependency validation requires --profile and --credential-directory");
  }
  const profile = await loadManagedDependencyProfile({ profilePath, credentialDirectory });
  const evidence = await validateManagedDependencyProfile(profile, runtimeFactsFromCli());
  console.log(JSON.stringify(evidence, null, 2));
}

export { parseManagedDependencyProfile, validateManagedDependencyProfile };

if (import.meta.url === `file://${process.argv[1]}`) {
  runControlPlaneManagedDependenciesCli().catch((error) => {
    console.error(`Error: ${redactConfigDiagnostic(String((error as Error)?.message || error))}`);
    process.exit(1);
  });
}

function runtimeFactsFromCli(): ManagedRuntimePathFacts {
  const sourceHostIdentity =
    getFlagStr("source-host-identity", "").trim() ||
    String(process.env.VBR_MANAGED_DEPENDENCY_SOURCE_HOST_IDENTITY || "").trim() ||
    undefined;
  const rawKind =
    getFlagStr("source-host-kind", "").trim() ||
    String(process.env.VBR_MANAGED_DEPENDENCY_SOURCE_HOST_KIND || "unknown").trim();
  const nonCutoverDiagnostic =
    getFlagBool("non-cutover-diagnostic") ||
    String(process.env.VBR_MANAGED_DEPENDENCY_NON_CUTOVER_DIAGNOSTIC || "") === "1";
  return {
    hostProfile: flagOrEnv("host-profile") || (rawKind === "aws-ec2" ? "aws-ec2" : undefined),
    awsRegion: flagOrEnv("aws-region"),
    sourceHostIdentity,
    sourceHostKind: parseManagedRuntimeSourceHostKind(rawKind || "unknown"),
    nonCutoverDiagnostic: nonCutoverDiagnostic || undefined,
    supabaseProjectRef: flagOrEnv("supabase-project-ref"),
    supabaseRegion: flagOrEnv("supabase-region"),
    privatelinkEndpointId: flagOrEnv("privatelink-endpoint-id"),
    privatelinkResourceId: flagOrEnv("privatelink-resource-id"),
    s3VpcEndpointId: flagOrEnv("s3-vpc-endpoint-id"),
    s3EndpointPolicyDigest: flagOrEnv("s3-endpoint-policy-digest"),
    alternateBackendEvidenceRef: flagOrEnv("alternate-backend-evidence-ref"),
    alternateBackendEvidenceDigest: flagOrEnv("alternate-backend-evidence-digest"),
  };
}

function flagOrEnv(name: string): string | undefined {
  const envName = `VBR_MANAGED_DEPENDENCY_${name.replace(/-/g, "_").toUpperCase()}`;
  return getFlagStr(name, "").trim() || String(process.env[envName] || "").trim() || undefined;
}
