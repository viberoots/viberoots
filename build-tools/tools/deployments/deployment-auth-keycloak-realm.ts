#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";
import {
  normalizeDeploymentPkceCallbackProfile,
  urlHost,
} from "./deployment-pkce-callback-profile.ts";
import {
  reviewedAutomationGroupsForPrincipal,
  reviewedHumanGroupsForDeployment,
} from "./deployment-auth-groups.ts";

const DEFAULT_REALM = "deployments";
const DEFAULT_CLIENT_ID = "deployment-cli";

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function cliPublicClientId(deployment: DeploymentTarget): string {
  return deployment.vaultRuntime?.cliPublicClientId?.trim() || DEFAULT_CLIENT_ID;
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

function keycloakClient(deployments: DeploymentTarget[], clientId: string) {
  const redirectUris = uniqueSorted(
    deployments
      .filter((deployment) => cliPublicClientId(deployment) === clientId)
      .map(redirectUriFor),
  );
  return {
    clientId,
    name: clientId,
    enabled: true,
    publicClient: true,
    protocol: "openid-connect",
    directAccessGrantsEnabled: true,
    redirectUris,
    protocolMappers: [keycloakGroupsMapper(), keycloakEmailMapper()],
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
  return {
    realm: opts.realm || DEFAULT_REALM,
    enabled: true,
    groups: keycloakGroups(deployments, automationPrincipalIds),
    clients: clientIds.map((clientId) => keycloakClient(deployments, clientId)),
  };
}
