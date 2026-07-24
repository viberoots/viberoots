import * as fsp from "node:fs/promises";
import * as path from "node:path";

import {
  binWrapper,
  makeFakeAgentTools,
  scratchRoot,
  writeExecutable,
} from "./agent-wrapper-test-helpers.ts";

export const accountWrapper = binWrapper("codex");

export type AccountWrapperFixture = {
  tmp: string;
  home: string;
  gitRoot: string;
  bin: string;
  log: string;
  env: NodeJS.ProcessEnv;
};

export function sanitizedAccountWrapperEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key === "CODEX_HOME" ||
      key === "CODEX_ACCOUNT" ||
      key.startsWith("CODEX_ACCOUNT_") ||
      key === "CODEX_CLI_PATH" ||
      key.startsWith("VBR_CODEX_")
    ) {
      delete env[key];
    }
  }
  return { ...env, ...overrides };
}

export async function accountWrapperFixture(): Promise<AccountWrapperFixture> {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "codex-account-wrapper-"));
  const home = path.join(tmp, "home");
  const gitRoot = path.join(tmp, "repo");
  await Promise.all([
    fsp.mkdir(home, { recursive: true }),
    fsp.mkdir(gitRoot, { recursive: true }),
  ]);
  const fake = await makeFakeAgentTools(tmp, gitRoot, "codex");
  return {
    tmp,
    home,
    gitRoot,
    bin: fake.bin,
    log: fake.log,
    env: sanitizedAccountWrapperEnv({
      HOME: home,
      CODEX_CLI_PATH: "",
      VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(fake.bin, "codex"),
      PATH: `${path.dirname(accountWrapper)}:${fake.bin}:/usr/bin:/bin:${process.env.PATH || ""}`,
      VBR_CODEX_SAFEHOUSE: "0",
      VBR_CODEX_NONINTERACTIVE: "1",
      VBR_CODEX_VERSION_CHECK: "off",
    }),
  };
}

export async function createApiKeyAccount(
  home: string,
  name: string,
  key = "sk-test-only",
): Promise<string> {
  const account = path.join(home, ".codex-accounts", name);
  await fsp.mkdir(account, { recursive: true });
  await fsp.writeFile(
    path.join(account, "auth.json"),
    JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: key }),
  );
  return account;
}

export async function installCodexScript(
  fixture: AccountWrapperFixture,
  body: string,
): Promise<void> {
  await writeExecutable(
    path.join(fixture.bin, "codex"),
    `#!/usr/bin/env bash
set -eu
printf 'codex %s\\n' "$*" >> ${JSON.stringify(fixture.log)}
printf 'CODEX_HOME=%s\\n' "\${CODEX_HOME:-}" >> ${JSON.stringify(fixture.log)}
${body}
`,
  );
}

export async function cleanupAccountFixture(fixture: AccountWrapperFixture): Promise<void> {
  await fsp.rm(fixture.tmp, { recursive: true, force: true });
}
