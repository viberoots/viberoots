import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli";
import { parseControlPlaneRuntimeConfig } from "./control-plane-runtime-config";
import { CONTROL_PLANE_PRODUCTION_CREDENTIAL_ENV_NAMES } from "./control-plane-runtime-config-validation";
import { reviewedSourceCredentialFiles } from "./control-plane-runtime-reviewed-source-validation";
import type { ControlPlaneRuntimeConfig } from "./control-plane-runtime-config-types";
import { artifactCredentialFiles } from "./control-plane-artifact-credential-mode";
import { validateCredentialMap, type CredentialMap } from "./cloud-control-credential-map";
import type { SupabaseManagedPostgresProfile } from "./control-plane-supabase-postgres-profile";

type PreflightOptions = {
  bundleDir: string;
  credentialDirectory?: string;
  env?: NodeJS.ProcessEnv;
};

type CredentialManifest = {
  credentialDirectory?: string;
  reviewedSourceMode?: string;
  deploymentIds?: string[];
  requiredFiles?: string[];
};

export async function runCredentialPreflight(opts: PreflightOptions) {
  const bundleDir = path.resolve(opts.bundleDir);
  const manifest = await readManifest(bundleDir);
  const credentialMap = await readCredentialMap(bundleDir);
  const supabaseProfile = await readSupabaseProfile(bundleDir);
  const config = parseControlPlaneRuntimeConfig(
    await fsp.readFile(path.join(bundleDir, "config.yaml"), "utf8"),
  );
  const credentialDirectory = path.resolve(
    opts.credentialDirectory || manifest.credentialDirectory || config.credentials.directory,
  );
  const errors = [
    ...ambientCredentialErrors(opts.env || process.env),
    ...manifestContractErrors(manifest, config),
    ...validateCredentialMap(credentialMap, {
      requiredFiles: requiredFiles(manifest),
      supabaseProjectRef: supabaseProfile?.provisioning.projectRef,
      connectionMode: supabaseProfile?.connection.mode,
      reviewedSourceMode: config.reviewedSource.mode,
    }),
    ...(await fileErrors(credentialDirectory, requiredFiles(manifest))),
  ];
  return {
    schemaVersion: "control-plane-credential-preflight@1",
    ok: errors.length === 0,
    credentialDirectory,
    checkedFiles: requiredFiles(manifest),
    errors,
  };
}

async function readCredentialMap(bundleDir: string): Promise<CredentialMap | undefined> {
  const raw = await fsp
    .readFile(path.join(bundleDir, "credential-map.json"), "utf8")
    .catch(() => "");
  if (!raw) return undefined;
  return JSON.parse(raw) as CredentialMap;
}

async function readSupabaseProfile(
  bundleDir: string,
): Promise<SupabaseManagedPostgresProfile | undefined> {
  const raw = await fsp
    .readFile(path.join(bundleDir, "supabase-postgres.profile.json"), "utf8")
    .catch(() => "");
  if (!raw) return undefined;
  return JSON.parse(raw) as SupabaseManagedPostgresProfile;
}

export async function runCredentialPreflightCommand(): Promise<void> {
  const bundleDir = getFlagStr("bundle-dir", ".").trim();
  const credentialDirectory = getFlagStr("credential-directory", "").trim();
  const out = getFlagStr("out", "").trim();
  const result = await runCredentialPreflight({
    bundleDir,
    ...(credentialDirectory ? { credentialDirectory } : {}),
  });
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (out) await fsp.writeFile(out, text, "utf8");
  console.log(text.trimEnd());
  if (!result.ok) process.exitCode = 2;
}

async function readManifest(bundleDir: string): Promise<CredentialManifest> {
  const raw = await fsp.readFile(path.join(bundleDir, "credential-manifest.json"), "utf8");
  const manifest = JSON.parse(raw) as CredentialManifest;
  if (!Array.isArray(manifest.requiredFiles)) {
    throw new Error("credential-manifest.json requires requiredFiles");
  }
  return manifest;
}

function ambientCredentialErrors(env: NodeJS.ProcessEnv): string[] {
  const present = CONTROL_PLANE_PRODUCTION_CREDENTIAL_ENV_NAMES.filter(
    (name) => String(env[name] || "").trim() !== "",
  );
  return present.length
    ? [`ambient credential environment variables are not allowed: ${present.join(", ")}`]
    : [];
}

function manifestContractErrors(
  manifest: CredentialManifest,
  config: ControlPlaneRuntimeConfig,
): string[] {
  const errors: string[] = [];
  const actual = new Set(requiredFiles(manifest));
  const expected = new Set(expectedFiles(config));
  if (manifest.reviewedSourceMode && manifest.reviewedSourceMode !== config.reviewedSource.mode) {
    errors.push("credential manifest reviewed-source mode does not match config.yaml");
  }
  for (const id of manifest.deploymentIds || []) {
    if (!config.credentials.infisicalDeployments.some((entry) => entry.deploymentId === id)) {
      errors.push(`credential manifest deployment id is stale: ${id}`);
    }
  }
  for (const file of actual) if (/^env:/i.test(file)) errors.push(`${file} is env-var-only`);
  for (const file of expected)
    if (!actual.has(file)) errors.push(`credential manifest missing ${file}`);
  for (const file of actual)
    if (!expected.has(file)) errors.push(`credential manifest has unexpected ${file}`);
  return errors;
}

function expectedFiles(config: ControlPlaneRuntimeConfig): string[] {
  return [
    path.basename(config.database.urlFile),
    path.basename(config.service.tokenFile),
    ...artifactCredentialFiles(config.storage.artifactStore.credentialMode),
    ...reviewedSourceCredentialFiles(config).map(([, file]) => path.basename(file)),
    ...config.credentials.infisicalDeployments.flatMap((entry) => [
      entry.clientIdFileName || `${entry.deploymentId}-infisical-client-id`,
      entry.clientSecretFileName || `${entry.deploymentId}-infisical-client-secret`,
    ]),
  ];
}

async function fileErrors(directory: string, files: string[]): Promise<string[]> {
  const errors: string[] = [];
  for (const file of files) {
    const filePath = path.join(directory, file);
    try {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) {
        errors.push(`${file}: not a file`);
        continue;
      }
      const value = (await fsp.readFile(filePath, "utf8")).trim();
      if (!value) errors.push(`${file}: credential file must not be empty`);
      if (["control-plane-database-url", "artifact-store-endpoint"].includes(file)) {
        validateUrl(file, value, errors);
      }
    } catch (error) {
      errors.push(`${file}: missing or unreadable credential file`);
    }
  }
  return errors;
}

function validateUrl(file: string, value: string, errors: string[]): void {
  try {
    new URL(value);
  } catch {
    errors.push(`${file}: credential file must contain a valid URL`);
  }
}

function requiredFiles(manifest: CredentialManifest): string[] {
  return [...new Set(manifest.requiredFiles || [])];
}
