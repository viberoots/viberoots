#!/usr/bin/env zx-wrapper
import type { SprinkleRefBackendConfig } from "./sprinkleref-types";

export const GENERATED_INFISICAL_PROFILE_MARKER = "viberoots-repo-bootstrap";

export function starterInfisicalProfile(): SprinkleRefBackendConfig {
  return {
    backend: "infisical",
    generatedBy: GENERATED_INFISICAL_PROFILE_MARKER,
    host: "https://app.infisical.com",
    projectIdEnv: "VBR_INFISICAL_PROJECT_ID",
    defaultEnvironment: "staging",
    defaultPath: "/",
    clientIdEnv: "VBR_INFISICAL_CLIENT_ID",
    clientSecretEnv: "VBR_INFISICAL_CLIENT_SECRET",
  };
}

export function isGeneratedInfisicalResolverProfile(profile: SprinkleRefBackendConfig) {
  if (profile.generatedBy === GENERATED_INFISICAL_PROFILE_MARKER) return true;
  return isLegacyStarterProfile(profile);
}

function isLegacyStarterProfile(profile: SprinkleRefBackendConfig) {
  return (
    profile.backend === "infisical" &&
    profile.host === "https://app.infisical.com" &&
    profile.projectIdEnv === "VBR_INFISICAL_PROJECT_ID" &&
    profile.defaultEnvironment === "staging" &&
    profile.defaultPath === "/" &&
    profile.clientIdEnv === "VBR_INFISICAL_CLIENT_ID" &&
    profile.clientSecretEnv === "VBR_INFISICAL_CLIENT_SECRET" &&
    !profile.projectId &&
    !profile.projectName &&
    !profile.clientIdRef &&
    !profile.clientSecretRef
  );
}
