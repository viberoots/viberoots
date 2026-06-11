import { resolveStackRef, type StackInputSource } from "./aws-account-inputs";
import type {
  AwsAccountConfig,
  HttpFetch,
  RunDeps,
  SupabaseTokenResolution,
} from "./aws-account-types";

export async function getSupabaseJson(
  fetchImpl: HttpFetch,
  config: AwsAccountConfig,
  token: string,
  apiPath: string,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const response = await fetchImpl(`${config.supabaseApiBaseUrl}${apiPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const raw = await response.text();
  let json: unknown = {};
  if (raw.trim()) {
    try {
      json = JSON.parse(raw);
    } catch {
      json = { nonJsonBody: raw.slice(0, 200) };
    }
  }
  return { ok: response.ok, status: response.status, json };
}

export async function resolveSupabaseAccessToken(
  config: AwsAccountConfig,
  deps: RunDeps,
): Promise<SupabaseTokenResolution> {
  const env = deps.env || process.env;
  const envToken = env[config.supabaseAccessTokenEnv];
  if (envToken) {
    return {
      token: envToken,
      metadata: {
        source: "env",
        env: config.supabaseAccessTokenEnv,
        secretValuePrinted: false,
        valuePrinted: false,
      },
    };
  }
  const tokenInput = config.supabaseAccessToken;
  if (!tokenInput?.ref) {
    return {
      metadata: {
        source: "missing",
        env: config.supabaseAccessTokenEnv,
        secretValuePrinted: false,
        valuePrinted: false,
      },
    };
  }
  try {
    const resolved = await resolveStackRef(deps.cwd || process.cwd(), tokenInput.ref, {
      category: tokenInput.category,
      categoryExplicit: Boolean(tokenInput.category),
      secret: true,
      env,
    });
    const token = resolved.value;
    if (!token) {
      return {
        metadata: {
          ...resolved.source,
          secretValuePrinted: false,
          valuePrinted: false,
        },
        error:
          resolved.error ||
          `Supabase Management API token ref is configured but missing. Add ${tokenInput.ref} to SprinkleRef, or export ${config.supabaseAccessTokenEnv}=<token> for this setup run.`,
      };
    }
    return {
      token,
      metadata: {
        ...resolved.source,
        secretValuePrinted: false,
        valuePrinted: false,
      },
    };
  } catch (error) {
    return {
      metadata: {
        source: "sprinkleref",
        ref: tokenInput.ref,
        category: tokenInput.category,
        categoryExplicit: Boolean(tokenInput.category),
        secretValuePrinted: false,
        valuePrinted: false,
      },
      error: `Supabase Management API token ref could not be resolved from SprinkleRef. Fix supabaseAccessToken, local values, and SPRINKLEREF_CONFIG, or export ${config.supabaseAccessTokenEnv}=<token> for this setup run. Error: ${String(error instanceof Error ? error.message : error)}`,
    };
  }
}

export async function defaultHttpFetch(url: string, init?: { headers?: Record<string, string> }) {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
  };
}

export function tokenSource(metadata: Record<string, unknown>): StackInputSource {
  return {
    source: inputSourceName(metadata.source),
    ref: typeof metadata.ref === "string" ? metadata.ref : undefined,
    category: typeof metadata.category === "string" ? metadata.category : undefined,
    categoryExplicit: metadata.categoryExplicit === true,
    env: typeof metadata.env === "string" ? metadata.env : undefined,
    localValuesPath:
      typeof metadata.localValuesPath === "string" ? metadata.localValuesPath : undefined,
    localValuesEntryPath:
      typeof metadata.localValuesEntryPath === "string" ? metadata.localValuesEntryPath : undefined,
    redirectRef: typeof metadata.redirectRef === "string" ? metadata.redirectRef : undefined,
    redirectSource:
      metadata.redirectSource && typeof metadata.redirectSource === "object"
        ? tokenSource(metadata.redirectSource as Record<string, unknown>)
        : undefined,
    backend: typeof metadata.backend === "string" ? metadata.backend : undefined,
    valuePrinted: metadata.valuePrinted === true,
  };
}

function inputSourceName(value: unknown): StackInputSource["source"] {
  const source = typeof value === "string" ? value : "missing";
  if (
    source === "cli" ||
    source === "inline" ||
    source === "default" ||
    source === "local-values" ||
    source === "sprinkleref" ||
    source === "env"
  ) {
    return source;
  }
  return "missing";
}
