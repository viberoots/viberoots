#!/usr/bin/env zx-wrapper
import { shSingleQuote } from "../lib/shell-quote.ts";

export const REMOTE_SSH_IDENTITY_FILE_ENV = "BNX_REMOTE_SSH_IDENTITY_FILE";
export const REMOTE_SSH_KNOWN_HOSTS_FILE_ENV = "BNX_REMOTE_SSH_KNOWN_HOSTS_FILE";

type ReviewedRemoteEnv = NodeJS.ProcessEnv;

export type ReviewedRemoteSshAuth = {
  identityFile: string;
  knownHostsFile: string;
};

function readEnvValue(env: ReviewedRemoteEnv, name: string): string {
  return String(env[name] || "").trim();
}

export function readReviewedRemoteSshAuth(
  env: ReviewedRemoteEnv = process.env,
): ReviewedRemoteSshAuth | undefined {
  const identityFile = readEnvValue(env, REMOTE_SSH_IDENTITY_FILE_ENV);
  const knownHostsFile = readEnvValue(env, REMOTE_SSH_KNOWN_HOSTS_FILE_ENV);
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
): ReviewedRemoteSshAuth {
  const auth = readReviewedRemoteSshAuth(env);
  if (!auth) {
    throw new Error(
      `reviewed remote SSH auth requires ${REMOTE_SSH_IDENTITY_FILE_ENV} and ${REMOTE_SSH_KNOWN_HOSTS_FILE_ENV}`,
    );
  }
  return auth;
}

export function buildReviewedRemoteSshArgvPrefix(env: ReviewedRemoteEnv = process.env): string[] {
  const auth = requireReviewedRemoteSshAuth(env);
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
): string | undefined {
  requireReviewedRemoteSshAuth(env);
  return buildReviewedRemoteSshArgvPrefix(env)
    .map((arg) => shSingleQuote(arg))
    .join(" ");
}
