import * as fsp from "node:fs/promises";
import path from "node:path";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import { runCommand } from "./filtered-flake-command";

export async function registerEvaluationBundle(
  bundleRoot: string,
  recordProcessGroup: (processGroupId: number) => void = () => {},
  artifactEnv?: NodeJS.ProcessEnv,
): Promise<string> {
  if (!artifactEnv) {
    throw new Error(
      "registerEvaluationBundle requires an explicit artifactEnv; the caller must resolve authority at the public boundary.",
    );
  }
  const env = artifactEnv;
  const result = await runCommand({
    command: ensureNixStoreToolPathSync("nix", env),
    args: ["store", "add-path", "--name", "viberoots-evaluation-bundle", bundleRoot],
    env,
    allowFailure: true,
    timeoutMs: 120_000,
    killGraceMs: 10_000,
    onSpawn: recordProcessGroup,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `evaluation bundle registration failed: ${String(result.stderr || result.stdout).trim()}`,
    );
  }
  const storePath = String(result.stdout || "").trim();
  if (!/^\/nix\/store\/[a-z0-9]{32}-viberoots-evaluation-bundle$/.test(storePath)) {
    throw new Error(`evaluation bundle registration returned invalid store path: ${storePath}`);
  }
  await fsp.access(path.join(storePath, "schema.json"));
  await fsp.access(path.join(storePath, "source"));
  return storePath;
}
