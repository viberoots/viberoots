#!/usr/bin/env zx-wrapper
import {
  readSprinkleRefConfig,
  resolveSprinkleRefBackend,
  type SprinkleRefConfig,
} from "./sprinkleref-config";
import { assertBootstrapCategoryCanWrite } from "./sprinkleref-bootstrap-guard";
import type { SprinkleRefBackendConfig, SprinkleRefStore } from "./sprinkleref-types";
import { SprinkleRefLocalFileStore } from "./sprinkleref-local-file";
import { SprinkleRefMacosKeychainStore } from "./sprinkleref-keychain";
import {
  redactInfisicalCredentialJson,
  redactInfisicalCredentialText,
  resolveInfisicalAccessToken,
  type InfisicalCredentialConfig,
} from "./deployment-secret-infisical-credentials";

export class SprinkleRefInfisicalStore implements SprinkleRefStore {
  private readonly config: SprinkleRefBackendConfig;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly platform?: NodeJS.Platform;
  private readonly resolverConfig?: SprinkleRefConfig;

  constructor(
    config: SprinkleRefBackendConfig,
    env: NodeJS.ProcessEnv = process.env,
    fetchImpl: typeof fetch = fetch,
    platform?: NodeJS.Platform,
    resolverConfig?: SprinkleRefConfig,
  ) {
    this.config = config;
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.platform = platform;
    this.resolverConfig = resolverConfig;
  }

  describe() {
    const projectName = this.config.projectName ? ` (${this.config.projectName})` : "";
    return `infisical project ${this.projectId()}${projectName} environment ${this.config.defaultEnvironment}`;
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
    const token = await resolveInfisicalAccessToken(await this.credential(), {
      fetchImpl: this.fetchImpl,
    });
    const storage = infisicalStorage(ref);
    const url = this.url(storage, value);
    return await this.fetchImpl(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token.accessToken}`,
        ...(secretValue === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(secretValue === undefined
        ? {}
        : {
            body: JSON.stringify({
              projectId: this.projectId(),
              environment: this.config.defaultEnvironment || "",
              secretPath: storage.secretPath,
              type: "shared",
              secretValue,
              secretMetadata: { sprinkleref: ref },
            }),
          }),
    });
  }

  private url(storage: InfisicalStorage, viewSecretValue: boolean) {
    const url = new URL(
      `/api/v4/secrets/${encodeURIComponent(storage.secretName)}`,
      this.config.host,
    );
    url.searchParams.set("projectId", this.projectId());
    url.searchParams.set("environment", this.config.defaultEnvironment || "");
    url.searchParams.set("secretPath", storage.secretPath);
    url.searchParams.set("type", "shared");
    url.searchParams.set("viewSecretValue", viewSecretValue ? "true" : "false");
    url.searchParams.set("expandSecretReferences", "false");
    url.searchParams.set("includeImports", "false");
    return url;
  }

  private async credential(): Promise<InfisicalCredentialConfig> {
    const clientId = await this.credentialValue(
      "client id",
      this.config.clientIdEnv,
      this.config.clientIdRef,
    );
    const clientSecret = await this.credentialValue(
      "client secret",
      this.config.clientSecretEnv,
      this.config.clientSecretRef,
    );
    if (!clientId || !clientSecret) {
      throw new Error("missing Infisical Universal Auth environment variables");
    }
    return { kind: "universal_auth", siteUrl: this.config.host || "", clientId, clientSecret };
  }

  private async credentialValue(label: string, envName?: string, ref?: string) {
    const envValue = String(this.env[envName || ""] || "").trim();
    if (envValue || !ref) return envValue;
    const config = this.resolverConfig || (await readSprinkleRefConfig());
    const resolved = resolveSprinkleRefBackend(config, "bootstrap");
    assertBootstrapCategoryCanWrite(resolved);
    const store = bootstrapCredentialStore(resolved.backend, this.platform);
    const value = await store.read(ref);
    if (!value) throw new Error(`missing Infisical Universal Auth ${label} credential ${ref}`);
    return value.trim();
  }

  private projectId() {
    const fromEnv = this.config.projectIdEnv ? this.env[this.config.projectIdEnv] : undefined;
    const projectId = this.config.projectId || String(fromEnv || "").trim();
    if (!projectId) throw new Error("missing Infisical project id");
    return projectId;
  }
}

function bootstrapCredentialStore(backend: SprinkleRefBackendConfig, platform?: NodeJS.Platform) {
  if (backend.backend === "local-file") return new SprinkleRefLocalFileStore(backend.file || "");
  if (backend.backend === "macos-keychain") {
    return new SprinkleRefMacosKeychainStore(backend.service || "", platform);
  }
  throw new Error(
    `unsupported bootstrap credential backend for Infisical profile: ${backend.backend}`,
  );
}

type InfisicalStorage = {
  secretPath: string;
  secretName: string;
};

export function infisicalStorage(ref: string): InfisicalStorage {
  const stripped = ref.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const segments = stripped.split("/").filter(Boolean);
  const secretName = segments.pop() || ref;
  return {
    secretPath: segments.length ? `/${segments.join("/")}` : "/",
    secretName,
  };
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
