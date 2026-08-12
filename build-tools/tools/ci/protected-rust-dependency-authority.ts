import path from "node:path";
import { verifiedRegistrySourceCopy } from "../dev/install/cargo-registry-integrity";
import { artifactTransportEnvironment } from "../lib/artifact-environment";
import { runArtifactTool } from "./artifact-command";
import {
  createProtectedDependencySource,
  dependencyKey,
  PROTECTED_DEPENDENCY,
  PROTECTED_DEPENDENCY_STORE_NAME,
  type ProtectedDependencyAuthority,
} from "./protected-rust-patch-consumer";

type ExactNix = {
  runNix(args: string[]): Promise<{ stdout: string; stderr: string }>;
};

export async function materializeProtectedRustDependency(opts: {
  ownerRoot: string;
  artifactToolsRoot: string;
  active: ExactNix;
  localRunNix?: ExactNix["runNix"];
}): Promise<ProtectedDependencyAuthority> {
  const dependency = await createProtectedDependencySource(opts.ownerRoot);
  const verified = await verifyProtectedRustDependencySource(dependency);
  const transportEnv = artifactTransportEnvironment(process.env);
  delete transportEnv.VBR_ARTIFACT_TOOLS_ROOT;
  const localRunNix =
    opts.localRunNix ||
    (async (args: string[]) =>
      await runArtifactTool({
        tool: "nix",
        args,
        workspaceRoot: opts.ownerRoot,
        artifactToolsRoot: opts.artifactToolsRoot,
        baseEnv: transportEnv,
      }));
  try {
    const localStorePath = onlyStorePath(
      (
        await localRunNix([
          "store",
          "add-path",
          "--name",
          PROTECTED_DEPENDENCY_STORE_NAME,
          verified.root,
        ])
      ).stdout,
      "local dependency",
    );
    const localNarHash = exactNarHash(
      (await localRunNix(["hash", "path", localStorePath])).stdout,
      "local dependency",
    );
    await opts.active.runNix(["copy", "--from", "daemon", localStorePath]);
    const remoteStorePath = onlyPathInfoStorePath(
      (await opts.active.runNix(["path-info", "--json", localStorePath])).stdout,
    );
    const remoteNarHash = exactNarHash(
      (await opts.active.runNix(["hash", "path", remoteStorePath])).stdout,
      "reviewed remote dependency",
    );
    if (remoteStorePath !== localStorePath || remoteNarHash !== localNarHash) {
      throw new Error("protected Rust dependency differs between local and reviewed Nix stores");
    }
    return {
      checksum: dependency.checksum,
      storePath: localStorePath,
      narHash: localNarHash,
    };
  } finally {
    await verified.cleanup();
  }
}

export async function verifyProtectedRustDependencySource(dependency: {
  sourceRoot: string;
  checksum: string;
}): Promise<{ root: string; cleanup: () => Promise<void> }> {
  return verifiedRegistrySourceCopy(
    dependency.sourceRoot,
    dependencyKey(dependency.checksum),
    PROTECTED_DEPENDENCY.source,
    dependency.checksum,
  );
}

function onlyStorePath(stdout: string, label: string): string {
  const values = stdout.trim().split(/\s+/u).filter(Boolean);
  if (values.length !== 1 || !/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(values[0]!)) {
    throw new Error(`protected Rust ${label} is not one canonical store path`);
  }
  return values[0]!;
}

function onlyPathInfoStorePath(stdout: string): string {
  const parsed = JSON.parse(stdout) as unknown;
  const paths = Array.isArray(parsed)
    ? parsed.map((entry) => String((entry as { path?: unknown }).path || ""))
    : Object.keys(parsed as Record<string, unknown>);
  if (paths.length !== 1) throw new Error("reviewed Rust dependency path-info is not singular");
  return onlyStorePath(paths[0]!, "reviewed remote dependency");
}

function exactNarHash(stdout: string, label: string): string {
  const value = stdout.trim();
  if (!/^sha256-[A-Za-z0-9+/]{43}=$/u.test(value)) {
    throw new Error(`protected Rust ${label} has an invalid NAR hash`);
  }
  return value;
}
