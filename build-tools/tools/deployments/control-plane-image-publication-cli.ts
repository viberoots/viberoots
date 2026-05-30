import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import { promisify } from "node:util";
import { getFlagStr } from "../lib/cli";
import {
  assertControlPlaneImageDigestReference,
  controlPlaneImagePublicationPlan,
} from "./control-plane-image-publication";
import {
  assertControlPlaneRegistryProfile,
  type ControlPlaneRegistryProfile,
  registryProfileSummary,
} from "./control-plane-registry-profile";

const execFileAsync = promisify(execFile);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export async function runControlPlaneImagePublicationCommand(): Promise<void> {
  const profile = await readRegistryProfile(requiredFlag("registry-profile"));
  const image = assertControlPlaneImageDigestReference(requiredFlag("image"));
  const out = requiredFlag("out");
  const sourceRevision = requiredFlag("source-revision");
  const imageBuildIdentity = requiredFlag("image-build-identity");
  const publishedDigest = digestFlag("published-digest") || digestFromImage(image);
  const inspectedDigest = await inspectDigest(image);
  if (publishedDigest !== inspectedDigest) {
    throw new Error("control-plane image publication digest does not match registry inspection");
  }
  const plan = controlPlaneImagePublicationPlan({
    repository: profile.repository,
    sourceRevision,
    imageBuildIdentity,
    digest: publishedDigest,
    inspectedDigest,
    imageTarball: getFlagStr("image-tarball", "result").trim(),
    registryProfile: profile,
    tag: getFlagStr("tag", "").trim() || undefined,
  });
  if (plan.digestRef !== image) {
    throw new Error(
      "control-plane image publication image reference must match registry profile repository and digest",
    );
  }
  const evidence = {
    schemaVersion: "cloud-control-image-publication@1",
    ...plan.manifest,
    registryProfileSummary: registryProfileSummary(profile),
    reviewedBuildCommands: [
      "nix build .#deployment-control-plane-image",
      "nix build .#deployment-control-plane-image-contract",
    ],
    inspection: {
      tool: "skopeo",
      image,
      digest: inspectedDigest,
    },
  };
  await fsp.writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function readRegistryProfile(filePath: string): Promise<ControlPlaneRegistryProfile> {
  const profile = JSON.parse(await fsp.readFile(filePath, "utf8")) as ControlPlaneRegistryProfile;
  assertControlPlaneRegistryProfile(profile);
  return profile;
}

async function inspectDigest(image: string): Promise<string> {
  const skopeo = getFlagStr("skopeo", "skopeo").trim();
  try {
    const result = await execFileAsync(
      skopeo,
      ["inspect", "--format", "{{.Digest}}", `docker://${image}`],
      { timeout: 120_000, maxBuffer: 1024 * 1024 },
    );
    const digest = String(result.stdout || "").trim();
    if (!DIGEST_PATTERN.test(digest)) {
      throw new Error("registry inspection did not return sha256:<64 lowercase hex>");
    }
    return digest;
  } catch (error) {
    throw new Error(`registry inspection failed: ${redacted(errorMessage(error))}`);
  }
}

function digestFlag(name: string): string | undefined {
  const value = getFlagStr(name, "").trim().toLowerCase();
  if (!value) return undefined;
  if (!DIGEST_PATTERN.test(value)) {
    throw new Error(`${name} must be sha256:<64 lowercase hex>`);
  }
  return value;
}

function digestFromImage(image: string): string {
  const digest = image.split("@").at(-1) || "";
  if (!DIGEST_PATTERN.test(digest)) {
    throw new Error("image reference must include sha256:<64 lowercase hex> digest");
  }
  return digest;
}

function requiredFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`image-publication requires --${name}`);
  return value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function redacted(value: string): string {
  return value
    .replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer <redacted>")
    .replace(/(password|secret|token|api[_-]?key)=\S+/gi, "$1=<redacted>");
}
