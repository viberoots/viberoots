#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import {
  normalizeDeploymentPkceCallbackProfile,
  urlHost,
} from "./deployment-pkce-callback-profile";
import {
  reviewedAutomationGroupsForPrincipal,
  reviewedHumanGroupsForDeployment,
} from "./deployment-auth-groups";

const DEFAULT_REALM = "deployments";
const DEFAULT_CLIENT_ID = "deployment-cli";
const DEFAULT_AUDIENCE = "deployments-vault";

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function cliPublicClientId(deployment: DeploymentTarget): string {
  return deployment.vaultRuntime?.cliPublicClientId?.trim() || DEFAULT_CLIENT_ID;
}

function serviceAccountClientId(deployment: DeploymentTarget): string | undefined {
  const metadata = deployment.vaultRuntime;
  return (
    metadata?.serviceAccountClientId?.trim() || metadata?.deploymentClientId?.trim() || undefined
  );
}

function redirectUriFor(deployment: DeploymentTarget): string {
  const profile = normalizeDeploymentPkceCallbackProfile(
    deployment.vaultRuntime?.pkceCallback || {
      mode: "public_host",
      externalScheme: "https",
      externalHost: "deploy-auth.apps.kilty.io",
      externalPath: "/oidc/callback",
      bindHost: "127.0.0.1",
      bindPort: 7780,
      bindPath: "/oidc/callback",
    },
  );
  const port = profile.externalPort ? `:${profile.externalPort}` : "";
  return `${profile.externalScheme}://${urlHost(profile.externalHost)}${port}${profile.externalPath}`;
}

function keycloakGroupsMapper() {
  return {
    name: "groups",
    protocol: "openid-connect",
    protocolMapper: "oidc-group-membership-mapper",
    consentRequired: false,
    config: {
      "claim.name": "groups",
      "full.path": "false",
      "id.token.claim": "true",
      "access.token.claim": "true",
      "userinfo.token.claim": "true",
    },
  };
}

function keycloakEmailMapper() {
  return {
    name: "email",
    protocol: "openid-connect",
    protocolMapper: "oidc-usermodel-property-mapper",
    consentRequired: false,
    config: {
      "user.attribute": "email",
      "claim.name": "email",
      "jsonType.label": "String",
      "id.token.claim": "true",
      "access.token.claim": "true",
      "userinfo.token.claim": "true",
    },
  };
}

function keycloakAudienceMapper(audience: string) {
  return {
    name: "audience",
    protocol: "openid-connect",
    protocolMapper: "oidc-audience-mapper",
    consentRequired: false,
    config: {
      "included.custom.audience": audience,
      "id.token.claim": "false",
      "access.token.claim": "true",
    },
  };
}

function keycloakHardcodedClaimMapper(claimName: string, value: string) {
  return {
    name: claimName,
    protocol: "openid-connect",
    protocolMapper: "oidc-hardcoded-claim-mapper",
    consentRequired: false,
    config: {
      "claim.name": claimName,
      "claim.value": value,
      "jsonType.label": "String",
      "id.token.claim": "false",
      "access.token.claim": "true",
      "userinfo.token.claim": "false",
    },
  };
}

function singleValue(values: string[]): string | undefined {
  const unique = uniqueSorted(values);
  return unique.length === 1 ? unique[0] : undefined;
}

function keycloakClient(
  deployments: DeploymentTarget[],
  clientId: string,
  clientKind: "public-cli" | "service-account",
) {
  const clientDeployments = deployments.filter(
    (deployment) =>
      (clientKind === "public-cli"
        ? cliPublicClientId(deployment)
        : serviceAccountClientId(deployment)) === clientId,
  );
  const redirectUris =
    clientKind === "public-cli" ? uniqueSorted(clientDeployments.map(redirectUriFor)) : [];
  const audience = singleValue(
    clientDeployments.map((deployment) => deployment.vaultRuntime?.audience || DEFAULT_AUDIENCE),
  );
  const deploymentEnvironment = singleValue(
    clientDeployments.map((deployment) => deployment.vaultRuntime?.deploymentEnvironment || ""),
  );
  const repository = singleValue(
    clientDeployments.map((deployment) => deployment.lanePolicy.governance.repository),
  );
  return {
    clientId,
    name: clientId,
    enabled: true,
    protocol: "openid-connect",
    publicClient: clientKind === "public-cli",
    directAccessGrantsEnabled: clientKind === "public-cli",
    ...(clientKind === "service-account"
      ? {
          clientAuthenticatorType: "client-secret",
          serviceAccountsEnabled: true,
          standardFlowEnabled: false,
          implicitFlowEnabled: false,
        }
      : {}),
    redirectUris,
    protocolMappers: [
      ...(clientKind === "public-cli" ? [keycloakGroupsMapper(), keycloakEmailMapper()] : []),
      ...(audience ? [keycloakAudienceMapper(audience)] : []),
      ...(deploymentEnvironment
        ? [keycloakHardcodedClaimMapper("deployment_environment", deploymentEnvironment)]
        : []),
      ...(repository ? [keycloakHardcodedClaimMapper("repository", repository)] : []),
    ],
  };
}

function keycloakGroups(
  deployments: DeploymentTarget[],
  automationPrincipalIds: string[],
): Array<{ name: string }> {
  const groups = uniqueSorted([
    ...deployments.flatMap(reviewedHumanGroupsForDeployment),
    ...automationPrincipalIds.flatMap((principalId) =>
      deployments.flatMap((deployment) =>
        reviewedAutomationGroupsForPrincipal(deployment, principalId),
      ),
    ),
  ]);
  return groups.map((name) => ({ name }));
}

export function buildDeploymentAuthKeycloakRealmImport(opts: {
  deployments: DeploymentTarget[];
  automationPrincipalIds?: string[];
  realm?: string;
}) {
  const deployments = opts.deployments;
  const automationPrincipalIds = uniqueSorted(opts.automationPrincipalIds || []);
  const clientIds = uniqueSorted(deployments.map(cliPublicClientId));
  const serviceClientIds = uniqueSorted(
    deployments.map(serviceAccountClientId).filter((value): value is string => Boolean(value)),
  ).filter((clientId) => !clientIds.includes(clientId));
  return {
    realm: opts.realm || DEFAULT_REALM,
    enabled: true,
    groups: keycloakGroups(deployments, automationPrincipalIds),
    clients: [
      ...clientIds.map((clientId) => keycloakClient(deployments, clientId, "public-cli")),
      ...serviceClientIds.map((clientId) =>
        keycloakClient(deployments, clientId, "service-account"),
      ),
    ],
  };
}
