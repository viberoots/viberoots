import type { DeploymentRuntimeMetadata } from "../../deployments/infisical-iac-bootstrap-types";

export const reviewedMetadata: Required<DeploymentRuntimeMetadata> = {
  siteUrl: "https://app.infisical.com",
  projectName: "sample-webapp-deployments",
  projectId: "977f71e8-f40b-44e6-b3bb-de0a7abbd826",
  projectSlug: "sample-webapp-deployments",
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
      identityName: "sample-webapp-staging-deploy",
      clientIdRef: "secret://deployments/sample-webapp/staging/infisical-client-id",
      clientSecretRef: "secret://deployments/sample-webapp/staging/infisical-client-secret",
      clientIdFileName: "sample-webapp-staging-infisical-client-id",
      clientSecretFileName: "sample-webapp-staging-infisical-client-secret",
    },
    {
      stage: "prod",
      identityId: "5e302d6c-3ac7-4fbc-a75f-b2312f33809a",
      identityName: "sample-webapp-prod-deploy",
      clientIdRef: "secret://deployments/sample-webapp/prod/infisical-client-id",
      clientSecretRef: "secret://deployments/sample-webapp/prod/infisical-client-secret",
      clientIdFileName: "sample-webapp-prod-infisical-client-id",
      clientSecretFileName: "sample-webapp-prod-infisical-client-secret",
    },
  ],
};
