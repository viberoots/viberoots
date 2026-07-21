import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { fakeRepoBootstrapFetch } from "./sprinkleref-test-helpers";

export async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-resolver-"));
}

export const projectConfigDir = () => path.join("projects", "config");
export const sharedConfigPath = () => path.join(projectConfigDir(), "shared.json");

export async function withCwdAndEnv(dir: string, run: () => Promise<void>) {
  const cwd = process.cwd();
  const oldEnv = { ...process.env };
  const oldFetch = globalThis.fetch;
  delete process.env.SPRINKLEREF_CONFIG;
  process.env.VBR_RUNTIME_HOST = "local-file";
  process.env.VBR_INFISICAL_PROJECT_ID = "proj_repo_test";
  process.env.INFISICAL_ACCESS_TOKEN = "admin-token";
  process.env.INFISICAL_CLIENT_ID = "client-id";
  process.env.INFISICAL_CLIENT_SECRET = "client-secret";
  process.env.VBR_VAULT_ADDR = "https://vault.test";
  process.env.VBR_VAULT_TOKEN = "vault-token";
  process.env.WORKSPACE_ROOT = dir;
  process.env._VIBEROOTS_DEVSHELL_ROOT = dir;
  process.env.LIVE_ROOT = dir;
  globalThis.fetch = fakeRepoBootstrapFetch as typeof fetch;
  process.chdir(dir);
  try {
    await run();
  } finally {
    process.chdir(cwd);
    process.env = oldEnv;
    globalThis.fetch = oldFetch;
  }
}

export async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeBootstrapKeychainConfig(service: string) {
  await writeJson("projects/config/shared.json", {
    sprinkleref: {
      version: 1,
      defaultCategory: "main",
      profiles: {
        "infisical-default": {
          backend: "infisical",
          host: "https://app.infisical.com",
          projectId: "project",
          defaultEnvironment: "staging",
          clientIdEnv: "INFISICAL_CLIENT_ID",
          clientSecretEnv: "INFISICAL_CLIENT_SECRET",
        },
      },
      categories: {
        main: { profile: "infisical-default" },
        bootstrap: { backend: "macos-keychain", service },
      },
    },
  });
}

export async function writeRuntimeHostKeychainConfig(service: string) {
  await writeJson("projects/config/shared.json", {
    schemaVersion: "viberoots-project-config@1",
    runtimeHosts: {
      "local-macos": { backend: "macos-keychain", service },
    },
    sprinkleref: {
      version: 1,
      defaultCategory: "main",
      profiles: {
        "infisical-default": {
          backend: "infisical",
          host: "https://app.infisical.com",
          projectId: "project",
          defaultEnvironment: "staging",
          clientIdEnv: "INFISICAL_CLIENT_ID",
          clientSecretEnv: "INFISICAL_CLIENT_SECRET",
        },
      },
      categories: {
        main: { profile: "infisical-default" },
      },
    },
  });
}
export async function writeGraph(nodes: unknown[]) {
  await writeJson(DEFAULT_GRAPH_PATH, { nodes });
}
