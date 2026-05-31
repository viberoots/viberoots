import * as fsp from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { getFlagStr } from "../lib/cli";
import type { CutoverEvidence } from "./cloud-control-cutover-types";
import { awsTopologyRequiredCapabilityIds } from "./cloud-control-aws-topology-capabilities";
import { digestCredentialInput } from "./control-plane-credential-staging-evidence";

export async function runCloudControlCutoverEvidenceCommand(): Promise<CutoverEvidence> {
  const bundleDir = path.resolve(getFlagStr("bundle-dir", ".").trim());
  const evidence = await collectCutoverEvidence(bundleDir);
  const out = getFlagStr("out", "").trim();
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  if (out) await fsp.writeFile(out, text, "utf8");
  else console.log(text.trimEnd());
  return evidence;
}

export async function collectCutoverEvidence(bundleDir: string): Promise<CutoverEvidence> {
  const root = path.resolve(bundleDir);
  const [configText, imagePublication, managedDependencies, topology] = await Promise.all([
    fsp.readFile(path.join(root, "config.yaml"), "utf8"),
    readJson(path.join(root, "image-publication.json")),
    readJson(path.join(root, "managed-dependency-evidence.json")),
    readJson(path.join(root, "aws-topology-evidence.json")),
  ]);
  const config = YAML.parse(configText);
  const selected = awsTopologyRequiredCapabilityIds(topology);
  const credentialStaging = await readJson(path.join(root, "credential-staging.json"));
  return {
    schemaVersion: "cloud-cutover-evidence@1",
    operationIdentity: {
      operation: "cutover",
      sourceHost: hostIdentity(topology),
      checkedAt: new Date().toISOString(),
    },
    checkedAt: new Date().toISOString(),
    hostProfile: "aws-ec2",
    region: String(topology?.region || topology?.awsRegion || ""),
    generatedAt: new Date().toISOString(),
    sourceHost: hostIdentity(topology),
    configDigest: digestCredentialInput(config),
    imageDigest: String(imagePublication?.image || ""),
    expectedImageBuildIdentity: String(imagePublication?.imageBuildIdentity || ""),
    selectedProviderCapabilities: selected,
    health: healthEvidence(root),
    imagePublication,
    managedDependencies,
    supabasePostgresProfile: await readJson(path.join(root, "supabase-postgres.profile.json")),
    awsTopology: topology,
    ingressCommandEvidence: await readIngressEvidence(root),
    latestNonProductionDeployment: await readJson(
      path.join(root, "latest-non-production-deployment.json"),
    ),
    runtimeConfig: {
      publicUrl: config?.service?.publicUrl,
      authProvider: config?.authProvider,
    },
    providerCapabilities: await providerCapabilityEvidence(root, selected),
    credentialManifestDigest: String(credentialStaging?.manifestDigest || ""),
    credentialMapDigest: String(credentialStaging?.credentialMapDigest || ""),
    credentialManifestRequiredFiles: await requiredCredentialFiles(root),
    credentialStaging,
    standby: await readJson(path.join(root, "standby-evidence.json")),
    restore: await readJson(path.join(root, "restore-evidence.json")),
    rollback: await readJson(path.join(root, "rollback-evidence.json")),
    breakGlass: await readJson(path.join(root, "break-glass-evidence.json")),
    audit: { cutover: { evidenceRef: "cloud-cutover-evidence.json" } },
  };
}

async function providerCapabilityEvidence(root: string, ids: string[]) {
  const entries = await Promise.all(ids.map(async (id) => [id, await providerEvidence(root, id)]));
  return Object.fromEntries(entries.filter(([, value]) => value));
}

async function providerEvidence(root: string, id: string) {
  const primary =
    id === "supabase-managed-postgres"
      ? "supabase-managed-postgres-evidence.json"
      : `provider-capability-${id}.json`;
  return readJson(path.join(root, primary));
}

async function readIngressEvidence(root: string) {
  const files = ["ingress-dns", "ingress-tls", "ingress-health", "ingress-callback"];
  const values = await Promise.all(
    files.map((name) => readJson(path.join(root, `${name}-evidence.json`))),
  );
  return Object.fromEntries(files.map((name, index) => [name, values[index]]));
}

function healthEvidence(root: string) {
  return {
    cloudHealth: { evidencePath: path.join(root, "http-health.json") },
    readiness: { evidencePath: path.join(root, "http-readiness.json") },
    workerHeartbeats: { evidencePath: path.join(root, "http-worker-heartbeats.json") },
    databaseConnectivity: { evidencePath: path.join(root, "managed-dependency-evidence.json") },
    artifactStoreCompatibility: {
      evidencePath: path.join(root, "managed-dependency-evidence.json"),
    },
    authCallbackReachability: { evidencePath: path.join(root, "ingress-callback.json") },
    uiReads: { evidencePath: path.join(root, "http-health.json") },
    mcpReads: { evidencePath: path.join(root, "http-readiness.json") },
  };
}

async function requiredCredentialFiles(root: string): Promise<string[]> {
  return ((await readJson(path.join(root, "credential-manifest.json")))?.requiredFiles || []).map(
    String,
  );
}

function hostIdentity(topology: any): string {
  return String(topology?.host?.instanceId || topology?.compute?.instanceId || "aws-ec2");
}

async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}
