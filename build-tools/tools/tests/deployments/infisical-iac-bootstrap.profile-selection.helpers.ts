import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fakeRepoBootstrapFetch } from "./sprinkleref-test-helpers";

const VAULT_PROFILE = {
  backend: "vault",
  addressEnv: "VBR_VAULT_ADDR",
  tokenEnv: "VBR_VAULT_TOKEN",
  mount: "secret",
  defaultPath: "/deployments",
};

export async function withRepoEnv(dir: string, run: () => Promise<void>) {
  const cwd = process.cwd();
  const oldEnv = { ...process.env };
  const oldFetch = globalThis.fetch;
  process.env = {
    ...oldEnv,
    INFISICAL_ACCESS_TOKEN: "admin-token",
    VBR_INFISICAL_PROJECT_ID: "proj_repo_test",
    WORKSPACE_ROOT: dir,
    _VIBEROOTS_DEVSHELL_ROOT: dir,
    LIVE_ROOT: dir,
  };
  delete process.env.SPRINKLEREF_CONFIG;
  delete process.env.VBR_VAULT_ADDR;
  delete process.env.VBR_VAULT_TOKEN;
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

export function sharedConfigPath() {
  return path.join("projects", "config", "shared.json");
}

export async function writeGraph(nodes: unknown[]) {
  await fs.mkdir(path.join(".viberoots", "workspace", "buck"), { recursive: true });
  await fs.writeFile(
    path.join(".viberoots", "workspace", "buck", "graph.json"),
    `${JSON.stringify({ nodes }, null, 2)}\n`,
  );
}

export async function writeResolverConfig(infisicalProfile: unknown) {
  await writeJson("projects/config/shared.json", resolverConfig(infisicalProfile));
}

export function resolverConfig(infisicalProfile: unknown) {
  return {
    sprinkleref: {
      version: 1,
      defaultCategory: "main",
      profiles: {
        "vault-default": VAULT_PROFILE,
        "infisical-operator": infisicalProfile,
      },
      categories: {
        main: { profile: "infisical-operator" },
        bootstrap: { backend: "local-file", file: ".local/bootstrap.json" },
      },
    },
  };
}

export function inlineInfisicalProfile() {
  return {
    backend: "infisical",
    host: "https://infisical.operator.example",
    projectId: "proj_operator",
    defaultEnvironment: "dev",
    defaultPath: "/operator",
    clientIdRef: "secret://operator/infisical/client-id",
    clientSecretRef: "secret://operator/infisical/client-secret",
  };
}

export function generatedInfisicalProfile() {
  return {
    backend: "infisical",
    generatedBy: "viberoots-repo-bootstrap",
    host: "https://app.infisical.com",
    projectIdEnv: "VBR_INFISICAL_PROJECT_ID",
    defaultEnvironment: "staging",
    defaultPath: "/",
    clientIdEnv: "VBR_INFISICAL_CLIENT_ID",
    clientSecretEnv: "VBR_INFISICAL_CLIENT_SECRET",
  };
}

export function projectIdEnvInfisicalProfile() {
  return {
    ...inlineInfisicalProfile(),
    projectId: undefined,
    projectIdEnv: "OPERATOR_INFISICAL_PROJECT_ID",
  };
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function fakeProjectApi() {
  return {
    async request() {
      return { workspaces: [] };
    },
  };
}

export async function captureConsole(run: () => Promise<void>) {
  const originalLog = console.log;
  const stdout: string[] = [];
  console.log = (value?: unknown) => stdout.push(String(value));
  try {
    await run();
  } finally {
    console.log = originalLog;
  }
  return { stdout: stdout.join("\n") };
}
