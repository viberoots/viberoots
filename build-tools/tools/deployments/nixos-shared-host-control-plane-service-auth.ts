#!/usr/bin/env zx-wrapper
import { LOCAL_FIXTURE_SERVICE_ENV } from "./deployment-service-transport-policy.ts";

function fixtureModeEnabled(localFixture: boolean | undefined, env: NodeJS.ProcessEnv): boolean {
  if (localFixture !== undefined) return localFixture;
  const value = String(env[LOCAL_FIXTURE_SERVICE_ENV] || "")
    .trim()
    .toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function runsInLocalFixtureMode(opts: {
  localFixture?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  return fixtureModeEnabled(opts.localFixture, opts.env || process.env);
}

export function assertReviewedServiceTokenConfigured(opts: {
  serviceToken?: string;
  context: string;
  localFixture?: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  if (opts.serviceToken || runsInLocalFixtureMode(opts)) return;
  throw new Error(
    `${opts.context} requires --token or BNX_DEPLOY_CONTROL_PLANE_TOKEN unless ${LOCAL_FIXTURE_SERVICE_ENV}=1 marks an explicit local fixture service`,
  );
}

export function requestHasReviewedBearerToken(opts: {
  authorizationHeader?: string | string[];
  serviceToken?: string;
  localFixture?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (!opts.serviceToken) return runsInLocalFixtureMode(opts);
  return opts.authorizationHeader === `Bearer ${opts.serviceToken}`;
}

export function assertReviewedServiceBearerToken(opts: {
  authorizationHeader?: string | string[];
  serviceToken?: string;
  localFixture?: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  if (requestHasReviewedBearerToken(opts)) return;
  throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
}
