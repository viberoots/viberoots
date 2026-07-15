import * as fsp from "node:fs/promises";
import path from "node:path";
import { runGomod2nixGenerateIn } from "../install/gomod2nix";
import { projectModuleDirs } from "./surfaces";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import { runManagedCommand } from "../../lib/managed-command";
import { withFileRollback } from "./file-transaction";

const DEFAULT_LANGUAGE_TIMEOUT_SECONDS = 600;
const MAX_LANGUAGE_TIMEOUT_SECONDS = 3600;

export function languageUpdateTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.VBR_UPDATE_LANGUAGE_TIMEOUT_SECONDS || DEFAULT_LANGUAGE_TIMEOUT_SECONDS);
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_LANGUAGE_TIMEOUT_SECONDS) {
    throw new Error(
      `VBR_UPDATE_LANGUAGE_TIMEOUT_SECONDS must be an integer from 1 to ${MAX_LANGUAGE_TIMEOUT_SECONDS}`,
    );
  }
  return seconds * 1000;
}

async function runLanguageCommand(
  command: string,
  args: string[],
  cwd: string,
  allowNonzeroWithStdout = false,
): Promise<string> {
  const result = await runManagedCommand({
    command,
    args,
    cwd,
    env: { ...process.env, GOTOOLCHAIN: "local" },
    timeoutMs: languageUpdateTimeoutMs(),
  });
  const acceptedDiff =
    allowNonzeroWithStdout &&
    result.code === 1 &&
    !result.timedOut &&
    !result.interrupted &&
    Boolean(result.stdout.trim());
  if ((!result.ok || result.interrupted) && !acceptedDiff) {
    const reason = result.timedOut
      ? `timed out after ${languageUpdateTimeoutMs() / 1000}s`
      : result.interrupted
        ? "was interrupted"
        : `exited ${String(result.code)}`;
    throw new Error(
      `${path.basename(command)} ${args.join(" ")} ${reason} in ${cwd}\n${result.stderr}`.trim(),
    );
  }
  return result.stdout;
}

export async function repairGoDependencies(
  root: string,
  verbose: boolean,
  upgrade = false,
  goBin = ensureNixStoreToolPathSync("go"),
): Promise<number> {
  let count = 0;
  for (const dir of await projectModuleDirs(root, "go.mod")) {
    const relative = path.relative(root, dir) || ".";
    await withFileRollback(
      ["go.mod", "go.sum", "gomod2nix.toml"].map((file) => path.join(dir, file)),
      async () => {
        const goSum = path.join(dir, "go.sum");
        if (upgrade) {
          if (verbose) console.log(`[update] Go: upgrading ${relative}`);
          await runLanguageCommand(goBin, ["get", "-u", "./..."], dir);
          await runLanguageCommand(goBin, ["mod", "tidy"], dir);
        } else {
          const missingSum = !(await fsp.access(goSum).then(
            () => true,
            () => false,
          ));
          const diff = await runLanguageCommand(goBin, ["mod", "tidy", "-diff"], dir, true);
          if (diff.trim() || missingSum) {
            if (verbose) console.log(`[update] Go: repairing ${relative}`);
            await runLanguageCommand(goBin, ["mod", "tidy"], dir);
          }
        }
        await fsp.access(goSum).catch(async () => await fsp.writeFile(goSum, "", "utf8"));
        await runGomod2nixGenerateIn(dir, false, verbose, false, true);
      },
    );
    count += 1;
  }
  return count;
}

export async function repairPythonDependencies(
  root: string,
  verbose: boolean,
  upgrade = false,
  uvBin = ensureNixStoreToolPathSync("uv"),
): Promise<number> {
  let count = 0;
  for (const dir of await projectModuleDirs(root, "pyproject.toml")) {
    const manifest = path.join(dir, "pyproject.toml");
    if (verbose)
      console.log(
        `[update] Python: ${upgrade ? "upgrading" : "reconciling"} ${path.relative(root, manifest)}`,
      );
    await withFileRollback([path.join(dir, "uv.lock")], async () => {
      await runLanguageCommand(uvBin, upgrade ? ["lock", "--upgrade"] : ["lock"], dir);
    });
    count += 1;
  }
  return count;
}
