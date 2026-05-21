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
  return isHistoricalStarterProfile(profile);
}

function isHistoricalStarterProfile(profile: SprinkleRefBackendConfig) {
  const expected = historicalStarterInfisicalProfile();
  const keys = Object.keys(profile);
  const expectedKeys = Object.keys(expected);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => profileValue(profile, key) === profileValue(expected, key))
  );
}

function historicalStarterInfisicalProfile(): SprinkleRefBackendConfig {
  return {
    backend: "infisical",
    host: "https://app.infisical.com",
    projectIdEnv: "VBR_INFISICAL_PROJECT_ID",
    defaultEnvironment: "staging",
    defaultPath: "/",
    clientIdEnv: "VBR_INFISICAL_CLIENT_ID",
    clientSecretEnv: "VBR_INFISICAL_CLIENT_SECRET",
  };
}

function profileValue(profile: SprinkleRefBackendConfig, key: string) {
  return (profile as Record<string, unknown>)[key];
}
