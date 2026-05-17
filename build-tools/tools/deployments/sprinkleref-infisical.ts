#!/usr/bin/env zx-wrapper
import {
  redactInfisicalCredentialJson,
  redactInfisicalCredentialText,
  resolveInfisicalAccessToken,
  type InfisicalCredentialConfig,
} from "./deployment-secret-infisical-credentials";
import type { SprinkleRefBackendConfig, SprinkleRefStore } from "./sprinkleref-types";

export class SprinkleRefInfisicalStore implements SprinkleRefStore {
  private readonly config: SprinkleRefBackendConfig;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;

  constructor(
    config: SprinkleRefBackendConfig,
    env: NodeJS.ProcessEnv = process.env,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.config = config;
    this.env = env;
    this.fetchImpl = fetchImpl;
  }

  describe() {
    return `infisical project ${this.config.projectId} environment ${this.config.defaultEnvironment}`;
  }

  async has(ref: string) {
    const response = await this.request("GET", ref, false);
    if (response.status === 404) return false;
    if (!response.ok) await throwInfisicalError("read", response);
    return true;
  }

  async read(ref: string) {
    const response = await this.request("GET", ref, true);
    if (response.status === 404) return undefined;
    if (!response.ok) await throwInfisicalError("read", response);
    const body = (await response.json()) as { secret?: { secretValue?: string } };
    return typeof body.secret?.secretValue === "string" ? body.secret.secretValue : undefined;
  }

  async add(ref: string, value: string) {
    if (await this.has(ref)) throw new Error(`${ref} already exists`);
    await this.write("POST", ref, value);
  }

  async update(ref: string, value: string) {
    if (!(await this.has(ref))) throw new Error(`${ref} is missing`);
    await this.write("PATCH", ref, value);
  }

  async remove(ref: string) {
    const response = await this.request("DELETE", ref, false);
    if (response.status === 404) throw new Error(`${ref} is missing`);
    if (!response.ok) await throwInfisicalError("remove", response);
  }

  private async write(method: "POST" | "PATCH", ref: string, value: string) {
    const response = await this.request(method, ref, true, value);
    if (!response.ok) await throwInfisicalError(method === "POST" ? "add" : "update", response);
  }

  private async request(method: string, ref: string, value: boolean, secretValue?: string) {
    const token = await resolveInfisicalAccessToken(this.credential(), {
      fetchImpl: this.fetchImpl,
    });
    const url = this.url(ref, value);
    return await this.fetchImpl(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token.accessToken}`,
        ...(secretValue === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(secretValue === undefined ? {} : { body: JSON.stringify({ secretValue }) }),
    });
  }

  private url(ref: string, viewSecretValue: boolean) {
    const url = new URL(`/api/v4/secrets/${encodeURIComponent(secretName(ref))}`, this.config.host);
    url.searchParams.set("projectId", this.config.projectId || "");
    url.searchParams.set("environment", this.config.defaultEnvironment || "");
    url.searchParams.set("secretPath", this.config.defaultPath || "/");
    url.searchParams.set("type", "shared");
    url.searchParams.set("viewSecretValue", viewSecretValue ? "true" : "false");
    url.searchParams.set("expandSecretReferences", "false");
    url.searchParams.set("includeImports", "false");
    return url;
  }

  private credential(): InfisicalCredentialConfig {
    if (this.config.tokenEnv) {
      const accessToken = String(this.env[this.config.tokenEnv] || "").trim();
      if (!accessToken) throw new Error(`missing Infisical token env ${this.config.tokenEnv}`);
      return { kind: "access_token", siteUrl: this.config.host || "", accessToken };
    }
    const clientId = String(this.env[this.config.clientIdEnv || ""] || "").trim();
    const clientSecret = String(this.env[this.config.clientSecretEnv || ""] || "").trim();
    if (!clientId || !clientSecret) {
      throw new Error("missing Infisical Universal Auth environment variables");
    }
    return { kind: "universal_auth", siteUrl: this.config.host || "", clientId, clientSecret };
  }
}

function secretName(ref: string) {
  return ref.split("/").filter(Boolean).pop() || ref;
}

async function throwInfisicalError(action: string, response: Response): Promise<never> {
  const text = await response.text();
  let rendered = text;
  try {
    rendered = JSON.stringify(redactInfisicalCredentialJson(JSON.parse(text)));
  } catch {}
  throw new Error(
    `Infisical secret ${action} failed: ${response.status} ${redactInfisicalCredentialText(rendered)}`,
  );
}
