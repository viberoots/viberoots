import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  assertArtifactReproducibilityEvidence,
  artifactToolClosureDigest,
  type ArtifactReproducibilityEvidence,
} from "../lib/artifact-reproducibility-evidence";

type RunNix = (args: string[]) => Promise<{ stdout: string; stderr?: string }>;

export type ReproducibilityProductionInput = {
  evaluationBundleRoot: string;
  replayEvaluationBundleRoot: string;
  expectedEvaluationBundleDigest: string;
  expectedBindingDigest: string;
  system: string;
  flakeRef: string;
  outputPath: string;
  subjectAuthority: ArtifactReproducibilityEvidence["subjectAuthority"];
  checkoutIdentity: string;
  builderAuthority: ArtifactReproducibilityEvidence["builderAuthority"];
};

export async function produceArtifactReproducibilityEvidence(
  input: ReproducibilityProductionInput,
  runNix: RunNix,
  deps: { readIdentity?: typeof readBundleIdentity } = {},
): Promise<ArtifactReproducibilityEvidence> {
  const identity = await (deps.readIdentity || readBundleIdentity)(input.evaluationBundleRoot);
  const replayIdentity = await (deps.readIdentity || readBundleIdentity)(
    input.replayEvaluationBundleRoot,
  );
  if (
    input.evaluationBundleRoot !== input.replayEvaluationBundleRoot ||
    canonicalJson(identity) !== canonicalJson(replayIdentity)
  ) {
    throw new Error("replayed evaluation-bundle materialization changed immutable identity");
  }
  if (identity.evaluationBundleDigest !== input.expectedEvaluationBundleDigest) {
    throw new Error("supplied evaluation-bundle digest does not match the immutable bundle");
  }
  const evaluationBundleAuthority: ArtifactReproducibilityEvidence["evaluationBundleAuthority"] = {
    sourceRoot: input.evaluationBundleRoot,
    digest: input.expectedEvaluationBundleDigest,
    bindingDigest: input.expectedBindingDigest,
    replayMaterializations: 2,
  };
  const initial = await readArtifactPathIdentity(input.outputPath, runNix);
  await runNix(["store", "verify", "--no-trust", input.outputPath]);
  const rebuilt = onlyPath(
    (await runNix(["build", "--rebuild", "--no-link", "--print-out-paths", input.flakeRef])).stdout,
  );
  if (rebuilt !== input.outputPath) throw new Error("forced rebuild changed the output store path");
  const rebuiltIdentity = await readArtifactPathIdentity(rebuilt, runNix);
  assertSamePathIdentity(initial, rebuiltIdentity, "forced rebuild");
  const warm = onlyPath(
    (await runNix(["build", "--no-link", "--print-out-paths", input.flakeRef])).stdout,
  );
  if (warm !== input.outputPath) throw new Error("warm build changed the output store path");
  const warmIdentity = await readArtifactPathIdentity(warm, runNix);
  assertSamePathIdentity(initial, warmIdentity, "warm build");
  const evidence: ArtifactReproducibilityEvidence = {
    schema: "viberoots.artifact-reproducibility-evidence.v4",
    classification: "hermetic",
    sourceRevision: identity.sourceRevision,
    immutableSourceDigest: identity.immutableSourceDigest,
    evaluationBundleAuthority,
    declaredGraphDigest: identity.declaredGraphDigest,
    dependencyLockDigest: identity.dependencyLockDigest,
    toolClosureDigest: identity.toolClosureDigest,
    toolClosureRoot: identity.toolClosureRoot,
    system: input.system,
    derivationPath: initial.derivationPath,
    outputPath: input.outputPath,
    narHash: initial.narHash,
    closureIdentityDigest: initial.closureIdentityDigest,
    subjectAuthority: input.subjectAuthority,
    checkoutIdentity: input.checkoutIdentity,
    builderAuthority: input.builderAuthority,
    forcedRebuild: true,
    warmIdentityStable: true,
  };
  assertArtifactReproducibilityEvidence(evidence);
  return evidence;
}

export async function readBundleIdentity(sourceRoot: string) {
  if (!sourceRoot.startsWith("/nix/store/")) {
    throw new Error("reproducibility evidence requires an immutable evaluation-bundle source");
  }
  const bundleRoot = path.dirname(sourceRoot);
  const [manifest, graph, dependencies, schema, classification, sourceAuthorityText] =
    await Promise.all([
      readRequired(path.join(bundleRoot, "manifest.json")),
      readRequired(path.join(bundleRoot, "graph.json")),
      readRequired(path.join(bundleRoot, "dependency-inputs.json")),
      readRequired(path.join(bundleRoot, "schema.json")),
      readRequired(path.join(bundleRoot, "classification.json")),
      readRequired(path.join(bundleRoot, "source-authority.json")),
    ]);
  if ((JSON.parse(classification) as { classification?: unknown }).classification !== "hermetic") {
    throw new Error("reproducibility evidence rejects a non-hermetic evaluation bundle");
  }
  const parsedDependencies = JSON.parse(dependencies) as { artifactToolsRoot?: unknown };
  const toolsRoot = String(parsedDependencies.artifactToolsRoot || "");
  if (!toolsRoot.startsWith("/nix/store/")) {
    throw new Error("evaluation bundle lacks a store-qualified tool closure");
  }
  const evaluationBundleDigest = String((JSON.parse(schema) as { digest?: unknown }).digest || "");
  if (!evaluationBundleDigest.startsWith("sha256:")) {
    throw new Error("evaluation bundle schema lacks its canonical digest");
  }
  const sourceAuthority = JSON.parse(sourceAuthorityText) as Record<string, unknown>;
  if (
    Object.keys(sourceAuthority).sort().join(",") !== "schema,sourceRevision" ||
    sourceAuthority.schema !== "viberoots.evaluation-bundle-source-authority.v1" ||
    !/^[a-f0-9]{40,64}$/u.test(String(sourceAuthority.sourceRevision || ""))
  ) {
    throw new Error("evaluation bundle lacks canonical immutable source authority");
  }
  return {
    evaluationBundleDigest,
    sourceRevision: String(sourceAuthority.sourceRevision),
    immutableSourceDigest: digest(manifest),
    declaredGraphDigest: digest(graph),
    dependencyLockDigest: digest(dependencies),
    toolClosureDigest: artifactToolClosureDigest(toolsRoot),
    toolClosureRoot: toolsRoot,
  };
}

export function opaqueIdentity(value: string): string {
  if (!value.trim()) throw new Error("identity input is required");
  return digest(path.resolve(value));
}

export async function readArtifactPathIdentity(outputPath: string, runNix: RunNix) {
  const derivationPath = onlyPath((await runNix(["path-info", "--derivation", outputPath])).stdout);
  const raw = JSON.parse((await runNix(["path-info", "--json", outputPath])).stdout) as unknown;
  const record = pathInfoRecord(raw, outputPath);
  const narHash = String(record.narHash || "");
  if (!narHash) throw new Error(`Nix path-info omitted the NAR hash for ${outputPath}`);
  const closure = JSON.parse(
    (await runNix(["path-info", "--recursive", "--json", outputPath])).stdout,
  ) as unknown;
  return { derivationPath, narHash, closureIdentityDigest: closureDigest(closure) };
}

function closureDigest(value: unknown): string {
  const records = Array.isArray(value)
    ? value
    : Object.entries((value || {}) as Record<string, unknown>).map(([storePath, entry]) => ({
        ...((entry || {}) as Record<string, unknown>),
        path: storePath,
      }));
  const identity = records
    .map((entry) => {
      const record = entry as Record<string, unknown>;
      const storePath = String(record.path || "");
      const narHash = String(record.narHash || "");
      if (!storePath.startsWith("/nix/store/") || !narHash) {
        throw new Error("recursive Nix path-info omitted closure path or NAR identity");
      }
      return { narHash, path: storePath };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  if (!identity.length) throw new Error("recursive Nix closure identity is empty");
  return digest(canonicalJson(identity));
}

function pathInfoRecord(value: unknown, outputPath: string): Record<string, unknown> {
  if (Array.isArray(value)) {
    const hit = value.find((entry) => (entry as { path?: unknown })?.path === outputPath);
    if (hit && typeof hit === "object") return hit as Record<string, unknown>;
  }
  if (value && typeof value === "object") {
    const hit = (value as Record<string, unknown>)[outputPath];
    if (hit && typeof hit === "object") return hit as Record<string, unknown>;
  }
  throw new Error(`Nix path-info omitted ${outputPath}`);
}

function assertSamePathIdentity(
  left: { derivationPath: string; narHash: string; closureIdentityDigest: string },
  right: { derivationPath: string; narHash: string; closureIdentityDigest: string },
  phase: string,
): void {
  if (
    left.derivationPath !== right.derivationPath ||
    left.narHash !== right.narHash ||
    left.closureIdentityDigest !== right.closureIdentityDigest
  ) {
    throw new Error(`${phase} changed derivation, output NAR, or recursive closure identity`);
  }
}

function onlyPath(stdout: string): string {
  const paths = stdout.trim().split(/\s+/u).filter(Boolean);
  if (paths.length !== 1 || !paths[0]!.startsWith("/nix/store/")) {
    throw new Error("Nix command must return exactly one store path");
  }
  return paths[0]!;
}

async function readRequired(file: string): Promise<string> {
  return await fs.readFile(file, "utf8").catch(() => {
    throw new Error(`evaluation bundle identity input is missing: ${path.basename(file)}`);
  });
}

function digest(value: string): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
