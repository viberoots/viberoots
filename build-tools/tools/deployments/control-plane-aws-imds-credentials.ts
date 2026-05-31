#!/usr/bin/env zx-wrapper
import { redactConfigDiagnostic } from "./control-plane-runtime-config-validation";

export type AwsTemporaryCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
  roleName: string;
};

export type ObservedAwsRoleIdentity = {
  roleName: string;
};

export type AwsCredentialProvider = () => Promise<AwsTemporaryCredentials>;

type ImdsOptions = {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

const DEFAULT_IMDS_ENDPOINT = "http://169.254.169.254";
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export function createImdsV2CredentialProvider(opts: ImdsOptions = {}): AwsCredentialProvider {
  const endpoint = (opts.endpoint || DEFAULT_IMDS_ENDPOINT).replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now || (() => new Date());
  let cached: AwsTemporaryCredentials | undefined;
  return async () => {
    if (cached && cached.expiration.getTime() - now().getTime() > REFRESH_SKEW_MS) return cached;
    cached = await fetchImdsCredentials({ endpoint, fetchImpl, now });
    return cached;
  };
}

export function observeAwsCredentialRole(
  provider: AwsCredentialProvider,
  observe: (identity: ObservedAwsRoleIdentity) => void,
): AwsCredentialProvider {
  return async () => {
    const credentials = await provider();
    observe({ roleName: credentials.roleName });
    return credentials;
  };
}

async function fetchImdsCredentials(opts: Required<ImdsOptions> & { endpoint: string }) {
  const token = await imdsText(opts, "/latest/api/token", {
    method: "PUT",
    headers: { "x-aws-ec2-metadata-token-ttl-seconds": "21600" },
  });
  const roleName = (
    await imdsText(opts, "/latest/meta-data/iam/security-credentials/", {
      headers: { "x-aws-ec2-metadata-token": token },
    })
  ).trim();
  if (!roleName) throw new Error("IMDSv2 did not return an IAM role name");
  const raw = await imdsText(opts, `/latest/meta-data/iam/security-credentials/${roleName}`, {
    headers: { "x-aws-ec2-metadata-token": token },
  });
  return parseImdsCredentialPayload(raw, roleName, opts.now());
}

export function parseImdsCredentialPayload(
  raw: string,
  roleName: string,
  now: Date = new Date(),
): AwsTemporaryCredentials {
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (value.Code !== "Success") throw new Error("IMDSv2 credential response was not successful");
  const expiration = new Date(stringField(value.Expiration, "Expiration"));
  if (!Number.isFinite(expiration.getTime()) || expiration <= now) {
    throw new Error("IMDSv2 returned expired credentials");
  }
  return {
    accessKeyId: stringField(value.AccessKeyId, "AccessKeyId"),
    secretAccessKey: stringField(value.SecretAccessKey, "SecretAccessKey"),
    sessionToken: stringField(value.Token, "Token"),
    expiration,
    roleName,
  };
}

async function imdsText(
  opts: Required<ImdsOptions> & { endpoint: string },
  path: string,
  init: RequestInit,
): Promise<string> {
  const response = await opts.fetchImpl(`${opts.endpoint}${path}`, init);
  if (!response.ok) throw new Error(`IMDSv2 request failed: ${response.status}`);
  return response.text();
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(redactConfigDiagnostic(`IMDSv2 credential response missing ${name}`));
  }
  return value;
}
