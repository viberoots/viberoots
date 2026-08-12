import crypto from "node:crypto";

type RunNix = (args: string[]) => Promise<{ stdout: string; stderr?: string }>;
type PathIdentity = {
  derivationPath: string;
  narHash: string;
  closureIdentityDigest: string;
};

export async function verifyArtifactOutputPair(
  input: { flakeRef: string; outputPath: string; provenanceOutputPath: string },
  runNix: RunNix,
): Promise<{ runtime: PathIdentity; provenance: PathIdentity }> {
  const runtime = await readArtifactPathIdentity(input.outputPath, runNix);
  const provenance =
    input.provenanceOutputPath === input.outputPath
      ? runtime
      : await readArtifactPathIdentity(input.provenanceOutputPath, runNix);
  if (runtime.derivationPath !== provenance.derivationPath) {
    throw new Error("runtime and provenance outputs do not belong to the same derivation");
  }
  await verifyStorePath(input.outputPath, runNix);
  if (input.provenanceOutputPath !== input.outputPath) {
    await verifyStorePath(input.provenanceOutputPath, runNix);
  }
  await verifyBuildPhase(input, runNix, runtime, provenance, true);
  await verifyBuildPhase(input, runNix, runtime, provenance, false);
  return { runtime, provenance };
}

async function verifyBuildPhase(
  input: { flakeRef: string; outputPath: string; provenanceOutputPath: string },
  runNix: RunNix,
  runtime: PathIdentity,
  provenance: PathIdentity,
  rebuild: boolean,
): Promise<void> {
  const phase = rebuild ? "forced rebuild" : "warm build";
  const runtimePath = await buildOutput(input.flakeRef, "out", rebuild, runNix);
  if (runtimePath !== input.outputPath) throw new Error(`${phase} changed the output store path`);
  const runtimeIdentity = await readArtifactPathIdentity(runtimePath, runNix);
  assertSamePathIdentity(runtime, runtimeIdentity, phase);
  const provenancePath =
    input.provenanceOutputPath === input.outputPath
      ? runtimePath
      : await buildOutput(input.flakeRef, "provenance", rebuild, runNix);
  if (provenancePath !== input.provenanceOutputPath) {
    throw new Error(`${phase} changed the provenance output store path`);
  }
  assertSamePathIdentity(
    provenance,
    provenancePath === runtimePath
      ? runtimeIdentity
      : await readArtifactPathIdentity(provenancePath, runNix),
    `${phase} provenance`,
  );
}

async function buildOutput(
  flakeRef: string,
  output: "out" | "provenance",
  rebuild: boolean,
  runNix: RunNix,
): Promise<string> {
  return onlyPath(
    (
      await runNix([
        "build",
        ...(rebuild ? ["--rebuild"] : []),
        "--no-link",
        "--print-out-paths",
        `${flakeRef}^${output}`,
      ])
    ).stdout,
  );
}

async function verifyStorePath(storePath: string, runNix: RunNix): Promise<void> {
  await runNix(["store", "verify", "--no-trust", storePath]);
}

export async function readArtifactPathIdentity(
  outputPath: string,
  runNix: RunNix,
): Promise<PathIdentity> {
  const derivationPath = onlyPath((await runNix(["path-info", "--derivation", outputPath])).stdout);
  const raw = JSON.parse((await runNix(["path-info", "--json", outputPath])).stdout) as unknown;
  const narHash = String(pathInfoRecord(raw, outputPath).narHash || "");
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
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

function pathInfoRecord(value: unknown, outputPath: string): Record<string, unknown> {
  if (Array.isArray(value)) {
    const hit = value.find((entry) => (entry as { path?: unknown })?.path === outputPath);
    if (hit && typeof hit === "object") return hit as Record<string, unknown>;
  } else if (value && typeof value === "object") {
    const hit = (value as Record<string, unknown>)[outputPath];
    if (hit && typeof hit === "object") return hit as Record<string, unknown>;
  }
  throw new Error(`Nix path-info omitted ${outputPath}`);
}

function assertSamePathIdentity(left: PathIdentity, right: PathIdentity, phase: string): void {
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
