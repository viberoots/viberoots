import * as fsp from "node:fs/promises";
import path from "node:path";
import { envWithResolvedNixBin, resolveToolPathSync } from "../lib/tool-paths";
import { runCommand } from "./filtered-flake-command";

export async function registerEvaluationBundle(
  bundleRoot: string,
  recordProcessGroup: (processGroupId: number) => void = () => {},
): Promise<string> {
  const env = envWithResolvedNixBin(process.env);
  const result = await runCommand({
    command: resolveToolPathSync("nix", env),
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
