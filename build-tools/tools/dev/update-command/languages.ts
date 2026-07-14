import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runGomod2nixGenerateIn, runGomod2nixScanAll } from "../install/gomod2nix";
import { projectModuleDirs } from "./surfaces";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";

type CommandResult = { exitCode: number; stdout: string; stderr: string };

async function run(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

export async function repairGoDependencies(root: string, verbose: boolean): Promise<void> {
  for (const dir of await projectModuleDirs(root, "go.mod")) {
    const goSum = path.join(dir, "go.sum");
    const missingSum = !(await fsp.access(goSum).then(
      () => true,
      () => false,
    ));
    const check = await run(process.env.UPDATE_GO_BIN || "go", ["mod", "tidy", "-diff"], dir);
    if (check.exitCode !== 0 && !check.stdout.trim()) {
      throw new Error(
        `go mod tidy check failed in ${path.relative(root, dir) || "."}\n${check.stderr}`,
      );
    }
    if (check.stdout.trim() || missingSum) {
      if (verbose) console.log(`[update] Go: repairing ${path.relative(root, dir) || "."}`);
      const repair = await run(process.env.UPDATE_GO_BIN || "go", ["mod", "tidy"], dir);
      if (repair.exitCode !== 0) {
        throw new Error(
          `go mod tidy failed in ${path.relative(root, dir) || "."}\n${repair.stderr}`,
        );
      }
      await fsp.access(goSum).catch(async () => await fsp.writeFile(goSum, "", "utf8"));
    }
    await runGomod2nixGenerateIn(dir, false, verbose);
  }
  await runGomod2nixScanAll(false, verbose);
}

export async function repairPythonDependencies(root: string, verbose: boolean): Promise<void> {
  const uvBin = ensureNixStoreToolPathSync("uv");
  for (const dir of await projectModuleDirs(root, "pyproject.toml")) {
    const manifest = path.join(dir, "pyproject.toml");
    if (verbose) console.log(`[update] Python: reconciling ${path.relative(root, manifest)}`);
    const result = await run(uvBin, ["lock"], dir);
    if (result.exitCode !== 0) {
      throw new Error(`uv lock failed in ${path.relative(root, dir) || "."}\n${result.stderr}`);
    }
  }
}
