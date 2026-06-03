import path from "node:path";
import { CONTROL_PLANE_CONFIG_REFS } from "./aws-account-ref-schemes";
import type { AwsAccountConfig, PhaseRecord, RunDeps } from "./aws-account-types";
import {
  defaultHttpFetch,
  getSupabaseJson,
  resolveSupabaseAccessToken,
  tokenSource,
} from "./aws-account-supabase-token";
import {
  firstString,
  objectValue,
  summarizeSupabaseOrganization,
  summarizeSupabaseProject,
  supabasePlanSupportsPrivateLink,
  writeEvidence,
} from "./aws-account-utils";

export async function checkSupabase(
  config: AwsAccountConfig,
  deps: RunDeps,
  now: string,
): Promise<PhaseRecord> {
  const missing = [];
  const missingConfigFields: MissingConfigField[] = [];
  if (!config.supabaseOrgId) {
    missing.push("Supabase organization is missing.");
    missingConfigFields.push({
      field: "supabaseOrgId",
      valueHint: "<supabase-org-id>",
      destination: "local-values-or-shared-resolver",
      ref: CONTROL_PLANE_CONFIG_REFS.supabaseOrgId,
      category: config.inputSources.supabaseOrgId?.category,
    });
  }
  if (!config.supabaseProjectRef) {
    missing.push("Supabase project ref is missing.");
    missingConfigFields.push({
      field: "supabaseProjectRef",
      valueHint: "<project-ref>",
      destination: "local-values-or-shared-resolver",
      ref: CONTROL_PLANE_CONFIG_REFS.supabaseProjectRef,
      category: config.inputSources.supabaseProjectRef?.category,
    });
  }
  if (config.supabaseRegion !== config.region) {
    missing.push("Supabase region must match the AWS region for PrivateLink.");
    missingConfigFields.push({
      field: "supabaseRegion",
      valueHint: config.region,
      destination: "stack-config",
    });
  }
  const tokenResolution = await resolveSupabaseAccessToken(config, deps);
  if (!tokenResolution.token) {
    missing.push(tokenResolution.error || "Supabase Management API token is missing.");
    missingConfigFields.push({
      field: "supabaseAccessToken",
      valueHint: '{ "ref": "secret://control-plane/supabase/management-api-token" }',
      destination: supabaseAccessTokenDestination(tokenResolution.metadata),
      ref: "secret://control-plane/supabase/management-api-token",
      category:
        typeof tokenResolution.metadata.category === "string"
          ? tokenResolution.metadata.category
          : undefined,
      note: `or export ${config.supabaseAccessTokenEnv}=<token> for this run; do not put token values in stack config, inputs.json, or evidence`,
    });
  }
  const evidence = path.join(config.evidenceDir, "check-supabase", "supabase-readiness.json");
  if (missing.length > 0) {
    await writeEvidence(evidence, {
      schemaVersion: "aws-account-supabase-readiness@1",
      checkedAt: now,
      supabaseOrgId: config.supabaseOrgId,
      supabaseProjectRef: config.supabaseProjectRef,
      supabaseRegion: config.supabaseRegion,
      supabaseAccessTokenEnv: config.supabaseAccessTokenEnv,
      supabaseAccessToken: tokenResolution.metadata,
      apiBaseUrl: config.supabaseApiBaseUrl,
      apiAccessChecked: false,
      errors: missing,
    });
    return {
      state: "blocked",
      message: `Supabase PrivateLink readiness is incomplete. ${missing.join(" ")}`,
      missingConfigFields,
      evidence,
      checkedAt: now,
      resolvedInputSources: { supabaseAccessToken: tokenSource(tokenResolution.metadata) },
    };
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  const requests: Array<{ name: string; path: string; status: number }> = [];
  const fetchImpl = deps.httpFetch || defaultHttpFetch;
  const projectPath = `/v1/projects/${encodeURIComponent(config.supabaseProjectRef || "")}`;
  let project: Record<string, unknown> = {};
  let organization: Record<string, unknown> = {};
  try {
    const projectResponse = await getSupabaseJson(
      fetchImpl,
      config,
      tokenResolution.token || "",
      projectPath,
    );
    requests.push({ name: "project", path: projectPath, status: projectResponse.status });
    project = objectValue(projectResponse.json);
    if (!projectResponse.ok) {
      errors.push(
        `Supabase project API access failed for ${config.supabaseProjectRef}: HTTP ${projectResponse.status}`,
      );
    }
    const responseRef = firstString(project, ["ref", "project_ref"]);
    if (responseRef && responseRef !== config.supabaseProjectRef) {
      errors.push(
        `Supabase project ref mismatch: expected ${config.supabaseProjectRef}, got ${responseRef}`,
      );
    }
    const responseRegion = firstString(project, ["region", "db_region", "cloud_region"]);
    if (!responseRegion) {
      errors.push("Supabase project API response did not include a region field");
    } else if (responseRegion !== config.supabaseRegion) {
      errors.push(
        `Supabase project region mismatch: expected ${config.supabaseRegion}, got ${responseRegion}`,
      );
    }
    const projectOrg = firstString(project, ["organization_id", "organization_slug", "org_id"]);
    if (projectOrg && config.supabaseOrgId && projectOrg !== config.supabaseOrgId) {
      errors.push(
        `Supabase organization mismatch: expected ${config.supabaseOrgId}, got ${projectOrg}`,
      );
    }
    if (config.supabaseOrgId) {
      const orgPath = `/v1/organizations/${encodeURIComponent(config.supabaseOrgId)}`;
      const orgResponse = await getSupabaseJson(
        fetchImpl,
        config,
        tokenResolution.token || "",
        orgPath,
      );
      requests.push({ name: "organization", path: orgPath, status: orgResponse.status });
      organization = objectValue(orgResponse.json);
      if (!orgResponse.ok) {
        errors.push(
          `Supabase organization API access failed for ${config.supabaseOrgId}: HTTP ${orgResponse.status}`,
        );
      }
      const orgPlan = firstString(organization, ["plan"]);
      if (!orgPlan) {
        errors.push("Supabase organization API response did not include a plan field");
      } else if (!supabasePlanSupportsPrivateLink(orgPlan)) {
        errors.push(
          `Supabase organization plan does not support this PrivateLink setup path: got ${orgPlan}; expected Team or Enterprise`,
        );
      }
      const orgId = firstString(organization, ["id", "slug"]);
      if (orgId && orgId !== config.supabaseOrgId) {
        errors.push(
          `Supabase organization id/slug mismatch: expected ${config.supabaseOrgId}, got ${orgId}`,
        );
      }
    }
  } catch (error) {
    errors.push(String(error instanceof Error ? error.message : error));
  }
  await writeEvidence(evidence, {
    schemaVersion: "aws-account-supabase-readiness@1",
    checkedAt: now,
    supabaseOrgId: config.supabaseOrgId,
    supabaseProjectRef: config.supabaseProjectRef,
    supabaseRegion: config.supabaseRegion,
    supabasePlanSource: "supabase-management-api",
    supabaseAccessTokenEnv: config.supabaseAccessTokenEnv,
    supabaseAccessToken: tokenResolution.metadata,
    apiBaseUrl: config.supabaseApiBaseUrl,
    apiAccessChecked: true,
    requests,
    project: summarizeSupabaseProject(project),
    organization: summarizeSupabaseOrganization(organization),
    errors: missing,
    apiErrors: errors,
    warnings,
  });
  return {
    state: errors.length > 0 ? "failed" : "passed",
    message:
      errors.length > 0
        ? `Supabase API validation failed: ${errors.join("; ")}`
        : "Supabase Management API access validated project, organization, region, and PrivateLink-capable plan",
    evidence,
    checkedAt: now,
    resolvedInputSources: { supabaseAccessToken: tokenSource(tokenResolution.metadata) },
  };
}

function supabaseAccessTokenDestination(
  metadata: Record<string, unknown>,
): "bootstrap-category" | "local-values-or-shared-resolver" {
  return metadata.category === "bootstrap" && metadata.categoryExplicit === true
    ? "bootstrap-category"
    : "local-values-or-shared-resolver";
}
