import { createSign } from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { mkdtempNoindex } from "../lib/macos-metadata";

export type ReviewedSourceGithubAppCredentialFiles = {
  mode: "github-app";
  githubAppIdFile: string;
  githubAppInstallationIdFile: string;
  githubAppPrivateKeyFile: string;
};

export type GithubAppTokenExchange = (opts: {
  appId: string;
  installationId: string;
  privateKey: string;
  jwt: string;
}) => Promise<string>;

export async function githubAppGitFetchEnv(
  credentials: ReviewedSourceGithubAppCredentialFiles,
  exchange: GithubAppTokenExchange = exchangeGithubAppInstallationToken,
): Promise<{ env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
  const appId = await readCredential(credentials.githubAppIdFile);
  const installationId = await readCredential(credentials.githubAppInstallationIdFile);
  const privateKey = await readCredential(credentials.githubAppPrivateKeyFile);
  const token = await exchange({
    appId,
    installationId,
    privateKey,
    jwt: githubAppJwt({ appId, privateKey }),
  });
  const tmpDir = await mkdtempNoindex("vbr-github-app-askpass-", {
    baseName: "vbr-github-app-askpass",
  });
  const askpass = path.join(tmpDir, "askpass.sh");
  await fsp.writeFile(askpass, `#!/bin/sh\nprintf '%s\\n' '${token.replace(/'/g, "'\\''")}'\n`, {
    mode: 0o700,
  });
  return {
    env: {
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: askpass,
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "url.https://x-access-token@github.com/.insteadOf",
      GIT_CONFIG_VALUE_0: "git@github.com:",
      GIT_CONFIG_KEY_1: "url.https://x-access-token@github.com/.insteadOf",
      GIT_CONFIG_VALUE_1: "ssh://git@github.com/",
    },
    cleanup: async () => {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

async function exchangeGithubAppInstallationToken(opts: {
  installationId: string;
  jwt: string;
}): Promise<string> {
  const response = await fetch(
    `https://api.github.com/app/installations/${opts.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${opts.jwt}`,
        "user-agent": "viberoots-deployment-control-plane",
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  if (!response.ok) throw new Error(`GitHub App token exchange failed: HTTP ${response.status}`);
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new Error("GitHub App token exchange response did not include a token");
  return body.token;
}

function githubAppJwt(opts: { appId: string; privateKey: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: opts.appId }));
  const input = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(input).sign(opts.privateKey);
  return `${input}.${base64Url(signature)}`;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

async function readCredential(filePath: string): Promise<string> {
  return (await fsp.readFile(filePath, "utf8")).trim();
}
