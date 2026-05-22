import type { DeploymentRuntimeMetadata } from "../../deployments/infisical-iac-bootstrap-types";

export const reviewedMetadata: Required<DeploymentRuntimeMetadata> = {
  siteUrl: "https://app.infisical.com",
  projectName: "pleomino-deployments",
  projectId: "977f71e8-f40b-44e6-b3bb-de0a7abbd826",
  projectSlug: "pleomino-deployments",
  secretPath: "/",
  cloudflareSecretName: "cloudflare_api_token",
  environments: {
    staging: { slug: "staging" },
    prod: { slug: "prod" },
  },
  deploymentCredentials: [
    {
      stage: "staging",
      identityId: "ae854a19-3537-4d40-8730-8314a74c3d04",
      identityName: "pleomino-staging-deploy",
      clientIdRef: "secret://deployments/pleomino/staging/infisical-client-id",
      clientSecretRef: "secret://deployments/pleomino/staging/infisical-client-secret",
      clientIdFileName: "pleomino-staging-infisical-client-id",
      clientSecretFileName: "pleomino-staging-infisical-client-secret",
    },
    {
      stage: "prod",
      identityId: "5e302d6c-3ac7-4fbc-a75f-b2312f33809a",
      identityName: "pleomino-prod-deploy",
      clientIdRef: "secret://deployments/pleomino/prod/infisical-client-id",
      clientSecretRef: "secret://deployments/pleomino/prod/infisical-client-secret",
      clientIdFileName: "pleomino-prod-infisical-client-id",
      clientSecretFileName: "pleomino-prod-infisical-client-secret",
    },
  ],
};
