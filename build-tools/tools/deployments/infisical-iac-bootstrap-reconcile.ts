import { canonicalInfisicalApiUrl } from "./infisical-iac-bootstrap-config";
import {
  buildMetadataHandoffPatch,
  isFirstBootstrapPlaceholder,
} from "./infisical-iac-bootstrap-metadata-handoff";
import type { DeploymentRuntimeMetadata } from "./infisical-iac-bootstrap-types";

export function reconcileDeploymentMetadata(
  live: DeploymentRuntimeMetadata,
  reviewed: Required<DeploymentRuntimeMetadata>,
  reviewedSource?: string,
) {
  const mismatches = [
    ...compareHost("site url", live.siteUrl, reviewed.siteUrl, true),
    ...compare("project name", live.projectName, reviewed.projectName, false),
    ...compare("project id", live.projectId, reviewed.projectId, true),
    ...compare("project slug", live.projectSlug, reviewed.projectSlug, false),
    ...compare("secret path", live.secretPath, reviewed.secretPath, false),
    ...compare(
      "cloudflare secret name",
      live.cloudflareSecretName,
      reviewed.cloudflareSecretName,
      false,
    ),
    ...Object.entries(reviewed.environments).flatMap(([stage, expected]) =>
      compare(`environment ${stage} slug`, live.environments?.[stage]?.slug, expected.slug, false),
    ),
    ...reviewed.deploymentCredentials.flatMap((expected) => {
      const actual = live.deploymentCredentials?.find((item) => item.stage === expected.stage);
      return [
        ...compare(`${expected.stage} identity id`, actual?.identityId, expected.identityId, true),
        ...compare(
          `${expected.stage} identity name`,
          actual?.identityName,
          expected.identityName,
          false,
        ),
        ...compare(
          `${expected.stage} client id ref`,
          actual?.clientIdRef,
          expected.clientIdRef,
          false,
        ),
        ...compare(
          `${expected.stage} client secret ref`,
          actual?.clientSecretRef,
          expected.clientSecretRef,
          false,
        ),
        ...compare(
          `${expected.stage} client id file name`,
          actual?.clientIdFileName,
          expected.clientIdFileName,
          true,
        ),
        ...compare(
          `${expected.stage} client secret file name`,
          actual?.clientSecretFileName,
          expected.clientSecretFileName,
          true,
        ),
      ];
    }),
  ];
  if (mismatches.length > 0) {
    const hardDrift = mismatches.filter((item) => !item.handoff);
    if (hardDrift.length === 0 && reviewedSource) {
      return {
        schemaVersion: "infisical-iac-bootstrap-reconciliation@1",
        status: "metadata_handoff_required" as const,
        mismatches: mismatches.map((item) => item.text),
        patch: buildMetadataHandoffPatch(live, reviewed, reviewedSource),
      };
    }
    throw new Error(
      [
        "OpenTofu output reconciliation failed against reviewed Pleomino Infisical metadata.",
        ...mismatches.map((item) => `- ${item.text}`),
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

function compare(label: string, actual?: string, expected?: string, canHandoff: boolean) {
  if (actual === expected) return [];
  return [
    {
      text: `${label}: live=${actual ?? "<missing>"} reviewed=${expected ?? "<missing>"}`,
      handoff: canHandoff && isFirstBootstrapPlaceholder(expected ?? ""),
    },
  ];
}

function compareHost(label: string, actual?: string, expected?: string, canHandoff: boolean) {
  return compare(
    label,
    canonicalInfisicalApiUrl(actual),
    canonicalInfisicalApiUrl(expected),
    canHandoff,
  );
}
