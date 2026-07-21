import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export function starterConfig() {
  return {
    version: 1,
    repoInfisicalProjectName: "fixture-repo",
    defaultCategory: "main",
    profiles: {
      "infisical-default": {
        backend: "infisical",
        host: "https://app.infisical.com",
        projectIdEnv: "VBR_INFISICAL_PROJECT_ID",
        defaultEnvironment: "staging",
        defaultPath: "/",
        clientIdEnv: "VBR_INFISICAL_CLIENT_ID",
        clientSecretEnv: "VBR_INFISICAL_CLIENT_SECRET",
      },
      "vault-default": {
        backend: "vault",
        addressEnv: "VBR_VAULT_ADDR",
        tokenEnv: "VBR_VAULT_TOKEN",
        mount: "secret",
        defaultPath: "/deployments",
      },
    },
    categories: {
      main: { profile: "infisical-default" },
      bootstrap: { backend: "local-file", file: ".local/bootstrap.json" },
    },
  };
}

export async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "infisical-profile-materialization-"));
}

export async function writeJson(file: string, value: unknown) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function fakeProjectApi(projects: Array<{ id: string; name: string; orgId?: string }> = []) {
  return {
    calls: [] as string[],
    async request(
      method: string,
      endpoint: string,
      body?: { projectName?: string },
      allow404?: boolean,
    ) {
      this.calls.push(`${method} ${endpoint}`);
      if (endpoint.includes("/memberships/identities/")) {
        if (method === "GET" && allow404) return undefined;
        return { identityMembership: { id: "membership_1" } };
      }
      if (method === "GET") return { workspaces: projects };
      return {
        project: { id: "proj_repo", name: body?.projectName || "fixture-repo", orgId: "org_1" },
      };
    },
  };
}

export function vaultEnv() {
  return { VBR_VAULT_ADDR: "https://vault.test", VBR_VAULT_TOKEN: "vault-token" };
}

export async function fakeVaultFetch() {
  return jsonResponse({ "secret/": { type: "kv" } });
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
