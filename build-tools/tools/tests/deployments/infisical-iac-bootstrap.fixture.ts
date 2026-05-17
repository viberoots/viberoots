import type { DeploymentRuntimeMetadata } from "../../deployments/infisical-iac-bootstrap-types";

export const reviewedMetadata: Required<DeploymentRuntimeMetadata> = {
  siteUrl: "https://us.infisical.com",
  projectName: "pleomino-deployments",
  projectId: "proj_pleomino_deployments",
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
      identityId: "identity_pleomino_staging_deploy",
      identityName: "pleomino-staging-deploy",
      clientIdRef: "secret://deployments/pleomino/staging/infisical-client-id",
      clientSecretRef: "secret://deployments/pleomino/staging/infisical-client-secret",
      clientIdFileName: "pleomino-staging-infisical-client-id",
      clientSecretFileName: "pleomino-staging-infisical-client-secret",
    },
    {
      stage: "prod",
      identityId: "identity_pleomino_prod_deploy",
      identityName: "pleomino-prod-deploy",
      clientIdRef: "secret://deployments/pleomino/prod/infisical-client-id",
      clientSecretRef: "secret://deployments/pleomino/prod/infisical-client-secret",
      clientIdFileName: "pleomino-prod-infisical-client-id",
      clientSecretFileName: "pleomino-prod-infisical-client-secret",
    },
  ],
};
