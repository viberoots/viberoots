import type { SprinkleRefBackendConfig } from "./sprinkleref-types";

export async function validateVaultRepoProfile(
  name: string,
  profile: SprinkleRefBackendConfig,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
) {
  if (profile.backend !== "vault") {
    throw new Error(`SprinkleRef profile ${name} must use vault backend; run repo bootstrap again`);
  }
  rejectPlaceholderVaultFields(name, profile);
  const address = profile.address || envValue(opts.env, profile.addressEnv);
  const token = envValue(opts.env, profile.tokenEnv);
  if (!address) {
    throw new Error(
      `Vault profile ${name} cannot be validated because ${profile.addressEnv || "address"} is unset; export the Vault address or write a concrete non-secret address in the resolver profile`,
    );
  }
  if (!token) {
    throw new Error(
      `Vault profile ${name} cannot be validated because ${profile.tokenEnv || "tokenEnv"} is unset; export a bootstrap Vault token through the configured env var`,
    );
  }
  await validateVaultMount(name, profile, address, token, opts.fetchImpl || fetch);
}

function rejectPlaceholderVaultFields(name: string, profile: SprinkleRefBackendConfig) {
  for (const [field, value] of Object.entries(profile)) {
    if (typeof value === "string" && /placeholder|fake|example-project-id/i.test(value)) {
      throw new Error(
        `SprinkleRef profile ${name} has placeholder ${field}; replace it with real Vault metadata`,
      );
    }
  }
}

async function validateVaultMount(
  name: string,
  profile: SprinkleRefBackendConfig,
  address: string,
  token: string,
  fetchImpl: typeof fetch,
) {
  const mount = profile.mount || "secret";
  const response = await fetchImpl(new URL("/v1/sys/mounts", address), {
    headers: { "X-Vault-Token": token, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Vault profile ${name} validation failed for ${address}: HTTP ${response.status}; verify address, token, namespace, and policy access`,
    );
  }
  const body = (await response.json()) as Record<string, unknown>;
  if (!body[`${mount}/`] && !body[mount]) {
    throw new Error(`Vault profile ${name} mount ${mount} was not found at ${address}`);
  }
}

function envValue(env = process.env, name?: string) {
  return name ? String(env[name] || "").trim() : "";
}
