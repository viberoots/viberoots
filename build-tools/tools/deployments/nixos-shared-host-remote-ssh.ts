#!/usr/bin/env zx-wrapper
import { shSingleQuote } from "../lib/shell-quote";

export const REMOTE_SSH_IDENTITY_FILE_ENV = "VBR_REMOTE_SSH_IDENTITY_FILE";
export const REMOTE_SSH_KNOWN_HOSTS_FILE_ENV = "VBR_REMOTE_SSH_KNOWN_HOSTS_FILE";

type ReviewedRemoteEnv = NodeJS.ProcessEnv;

export type ReviewedRemoteSshAuth = {
  identityFile: string;
  knownHostsFile: string;
};

type ReviewedRemoteSshFallback = {
  identityFile?: string;
  knownHostsFile?: string;
};

function readEnvValue(env: ReviewedRemoteEnv, name: string): string {
  return String(env[name] || "").trim();
}

export function readReviewedRemoteSshAuth(
  env: ReviewedRemoteEnv = process.env,
  fallback?: ReviewedRemoteSshFallback,
): ReviewedRemoteSshAuth | undefined {
  const identityFile =
    readEnvValue(env, REMOTE_SSH_IDENTITY_FILE_ENV) || String(fallback?.identityFile || "").trim();
  const knownHostsFile =
    readEnvValue(env, REMOTE_SSH_KNOWN_HOSTS_FILE_ENV) ||
    String(fallback?.knownHostsFile || "").trim();
  if (!identityFile && !knownHostsFile) return undefined;
  if (!identityFile || !knownHostsFile) {
    throw new Error(
      `reviewed remote SSH auth requires both ${REMOTE_SSH_IDENTITY_FILE_ENV} and ${REMOTE_SSH_KNOWN_HOSTS_FILE_ENV}`,
    );
  }
  return { identityFile, knownHostsFile };
}

export function requireReviewedRemoteSshAuth(
  env: ReviewedRemoteEnv = process.env,
  fallback?: ReviewedRemoteSshFallback,
): ReviewedRemoteSshAuth {
  const auth = readReviewedRemoteSshAuth(env, fallback);
  if (!auth) {
    throw new Error(
      `reviewed remote SSH auth requires ${REMOTE_SSH_IDENTITY_FILE_ENV} and ${REMOTE_SSH_KNOWN_HOSTS_FILE_ENV}`,
    );
  }
  return auth;
}

export function buildReviewedRemoteSshArgvPrefix(
  env: ReviewedRemoteEnv = process.env,
  fallback?: ReviewedRemoteSshFallback,
): string[] {
  const auth = requireReviewedRemoteSshAuth(env, fallback);
  return [
    "ssh",
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${auth.knownHostsFile}`,
    "-i",
    auth.identityFile,
  ];
}

export function buildReviewedRemoteRsyncShell(
  env: ReviewedRemoteEnv = process.env,
  fallback?: ReviewedRemoteSshFallback,
): string | undefined {
  requireReviewedRemoteSshAuth(env, fallback);
  return buildReviewedRemoteSshArgvPrefix(env, fallback)
    .map((arg) => shSingleQuote(arg))
    .join(" ");
}
