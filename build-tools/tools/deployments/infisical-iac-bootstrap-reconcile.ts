import { canonicalInfisicalApiUrl } from "./infisical-iac-bootstrap-config";
import type { DeploymentRuntimeMetadata } from "./infisical-iac-bootstrap-types";

export function reconcileDeploymentMetadata(
  live: DeploymentRuntimeMetadata,
  reviewed: Required<DeploymentRuntimeMetadata>,
) {
  const mismatches = [
    ...compareHost("site url", live.siteUrl, reviewed.siteUrl),
    ...compare("project name", live.projectName, reviewed.projectName),
    ...compare("project id", live.projectId, reviewed.projectId),
    ...compare("project slug", live.projectSlug, reviewed.projectSlug),
    ...compare("secret path", live.secretPath, reviewed.secretPath),
    ...compare("cloudflare secret name", live.cloudflareSecretName, reviewed.cloudflareSecretName),
    ...Object.entries(reviewed.environments).flatMap(([stage, expected]) =>
      compare(`environment ${stage} slug`, live.environments?.[stage]?.slug, expected.slug),
    ),
    ...reviewed.deploymentCredentials.flatMap((expected) => {
      const actual = live.deploymentCredentials?.find((item) => item.stage === expected.stage);
      return [
        ...compare(`${expected.stage} identity id`, actual?.identityId, expected.identityId),
        ...compare(`${expected.stage} identity name`, actual?.identityName, expected.identityName),
        ...compare(`${expected.stage} client id ref`, actual?.clientIdRef, expected.clientIdRef),
        ...compare(
          `${expected.stage} client secret ref`,
          actual?.clientSecretRef,
          expected.clientSecretRef,
        ),
        ...compare(
          `${expected.stage} client id file name`,
          actual?.clientIdFileName,
          expected.clientIdFileName,
        ),
        ...compare(
          `${expected.stage} client secret file name`,
          actual?.clientSecretFileName,
          expected.clientSecretFileName,
        ),
      ];
    }),
  ];
  if (mismatches.length > 0) {
    throw new Error(
      [
        "OpenTofu output reconciliation failed against reviewed Pleomino Infisical metadata.",
        ...mismatches.map((item) => `- ${item}`),
        "Concrete remediation:",
        "- Update projects/deployments/pleomino/shared/family.bzl reviewed constants:",
        "  _INFISICAL_SITE_URL, _INFISICAL_PROJECT_ID, _INFISICAL_MACHINE_IDENTITY_IDS, and _INFISICAL_CREDENTIAL_FILE_NAMES.",
        "- Keep the stable refs in this command's handoff report unchanged unless the reviewed naming convention changes.",
        "- Rerun this bootstrap command after patching metadata; do not attempt a live deployment until reconciliation passes.",
      ].join("\n"),
    );
  }
  return { schemaVersion: "infisical-iac-bootstrap-reconciliation@1", status: "ok" as const };
}

function compare(label: string, actual?: string, expected?: string) {
  return actual === expected
    ? []
    : [`${label}: live=${actual ?? "<missing>"} reviewed=${expected ?? "<missing>"}`];
}

function compareHost(label: string, actual?: string, expected?: string) {
  return compare(label, canonicalInfisicalApiUrl(actual), canonicalInfisicalApiUrl(expected));
}
