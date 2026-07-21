import path from "node:path";
import fs from "node:fs";
import {
  assertArtifactCommandSucceeded,
  runBoundedArtifactCommand,
} from "../lib/artifact-command-runner";
import {
  buildArtifactEnvironment,
  type ArtifactEnvironmentMode,
} from "../lib/artifact-environment";
import { artifactNixPolicyArgs } from "../lib/artifact-nix-policy";
import { ensureNixStoreToolPathSync, envWithResolvedNixBin } from "../lib/tool-paths";
import { redactPublisherOutput } from "./publisher-credentials";

export type ArtifactCommandResult = { stdout: string; stderr: string };

function declaredStoreExecutable(value: string): string {
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/bin\/[^/]+$/u.test(value)) {
    throw new Error(`declared publisher tool must be an absolute Nix-store executable: ${value}`);
  }
  const real = fs.realpathSync(value);
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\//u.test(real) || !fs.statSync(real).isFile()) {
    throw new Error(`declared publisher tool must resolve within the Nix store: ${value}`);
  }
  fs.accessSync(real, fs.constants.X_OK);
  return real;
}

export async function runArtifactTool(opts: {
  tool: string;
  args: string[];
  workspaceRoot: string;
  baseEnv?: NodeJS.ProcessEnv;
  mode?: ArtifactEnvironmentMode;
  artifactToolsRoot: string;
  declaredToolPath?: string;
}): Promise<ArtifactCommandResult> {
  const inherited = envWithResolvedNixBin(opts.baseEnv || process.env);
  const env = buildArtifactEnvironment({
    baseEnv: inherited,
    mode: opts.mode || (String(inherited.CI || "").trim() ? "ci" : "local"),
    stateRoot: path.join(opts.workspaceRoot, "buck-out", "tmp", "artifact-environment"),
    workspaceRoot: opts.workspaceRoot,
    artifactToolsRoot: opts.artifactToolsRoot,
  });
  const command = opts.declaredToolPath
    ? declaredStoreExecutable(opts.declaredToolPath)
    : ensureNixStoreToolPathSync(opts.tool, env);
  const result = await runBoundedArtifactCommand({
    command,
    args: opts.args,
    cwd: opts.workspaceRoot,
    env,
  });
  assertArtifactCommandSucceeded(command, result);
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function runDeclaredArtifactPublisher(opts: {
  tool: "attic" | "cachix";
  args: string[];
  workspaceRoot: string;
  artifactToolsRoot: string;
  declaredToolPath: string;
  publisherEnv: Readonly<Record<string, string>>;
}): Promise<ArtifactCommandResult> {
  const allowedKeys =
    opts.tool === "attic" ? ["ATTIC_TOKEN"] : ["CACHIX_AUTH_TOKEN", "CACHIX_SIGNING_KEY"];
  for (const key of Object.keys(opts.publisherEnv)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`unsupported ${opts.tool} publisher environment key ${key}`);
    }
  }
  const inherited = envWithResolvedNixBin(process.env);
  const canonicalEnv = buildArtifactEnvironment({
    baseEnv: inherited,
    mode: String(inherited.CI || "").trim() ? "ci" : "local",
    stateRoot: path.join(opts.workspaceRoot, "buck-out", "tmp", "artifact-environment"),
    workspaceRoot: opts.workspaceRoot,
    artifactToolsRoot: opts.artifactToolsRoot,
  });
  const command = declaredStoreExecutable(opts.declaredToolPath);
  const result = await runBoundedArtifactCommand({
    command,
    args: opts.args,
    cwd: opts.workspaceRoot,
    env: { ...canonicalEnv, ...opts.publisherEnv },
  });
  const redacted = {
    ...result,
    stdout: redactPublisherOutput(result.stdout, opts.publisherEnv),
    stderr: redactPublisherOutput(result.stderr, opts.publisherEnv),
  };
  assertArtifactCommandSucceeded(command, redacted);
  return { stdout: redacted.stdout, stderr: redacted.stderr };
}

export async function runArtifactNix(opts: {
  args: string[];
  workspaceRoot: string;
  baseEnv?: NodeJS.ProcessEnv;
  mode?: ArtifactEnvironmentMode;
  artifactToolsRoot: string;
}): Promise<ArtifactCommandResult> {
  return await runArtifactTool({
    ...opts,
    tool: "nix",
    args: [...artifactNixPolicyArgs(), ...opts.args],
  });
}

export async function readArtifactSystem(
  workspaceRoot: string,
  baseEnv: NodeJS.ProcessEnv,
  artifactToolsRoot: string,
): Promise<string> {
  const result = await runArtifactNix({
    args: ["config", "show", "--json"],
    workspaceRoot,
    baseEnv,
    artifactToolsRoot,
  });
  const parsed = JSON.parse(result.stdout) as Record<string, { value?: unknown } | unknown>;
  const entry = parsed.system;
  const value = entry && typeof entry === "object" ? (entry as { value?: unknown }).value : entry;
  const system = String(value || "").trim();
  if (!system) throw new Error("artifact Nix policy did not report the current system");
  return system;
}
