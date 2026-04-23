#!/usr/bin/env zx-wrapper

export const LOCAL_FIXTURE_SERVICE_ENV = "BNX_DEPLOY_LOCAL_FIXTURE_SERVICE";
export const INSECURE_TLS_OVERRIDE_ENV = "BNX_DEPLOY_INSECURE_TLS";

function envEnabled(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = String(env[name] || "")
    .trim()
    .toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function loopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){0,3}$/.test(host);
}

function assertTlsValidationEnabled(env: NodeJS.ProcessEnv, context: string): void {
  if (String(env.NODE_TLS_REJECT_UNAUTHORIZED || "").trim() === "0") {
    throw new Error(`${context} rejects disabled TLS certificate validation`);
  }
  if (envEnabled(env, INSECURE_TLS_OVERRIDE_ENV)) {
    throw new Error(`${context} rejects insecure TLS override ${INSECURE_TLS_OVERRIDE_ENV}`);
  }
}

export function validateProtectedSharedServiceTransport(opts: {
  controlPlaneUrl: string;
  context: string;
  env?: NodeJS.ProcessEnv;
  localFixture?: boolean;
  allowLoopbackHttp?: boolean;
}): string {
  const env = opts.env || process.env;
  assertTlsValidationEnabled(env, opts.context);
  const rawUrl = String(opts.controlPlaneUrl || "").trim();
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${opts.context} has invalid control-plane URL`);
  }
  if (url.protocol === "https:") return rawUrl;
  const localFixture =
    opts.localFixture || opts.allowLoopbackHttp || envEnabled(env, LOCAL_FIXTURE_SERVICE_ENV);
  if (url.protocol === "http:" && loopbackHost(url.hostname) && localFixture) return rawUrl;
  if (url.protocol === "http:" && loopbackHost(url.hostname)) {
    throw new Error(
      `${opts.context} requires ${LOCAL_FIXTURE_SERVICE_ENV}=1 for local fixture HTTP`,
    );
  }
  throw new Error(`${opts.context} requires HTTPS for protected/shared service traffic`);
}
