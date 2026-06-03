import * as fsp from "node:fs/promises";
import path from "node:path";
import * as readline from "node:readline/promises";
import { getFlagBool, getFlagStr } from "../lib/cli";
import type { RunDeps } from "./aws-account-types";
import { buildStackConfigValues } from "./aws-account-config-values";
import {
  defaultStackConfigPath,
  pathExists,
  readConfigFile,
  relativePath,
  renderStackConfigFile,
} from "./aws-account-utils";

export function isMissingStackIdentityError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("aws-account needs stack identity.");
}

export async function maybeInitStackConfigInteractively(
  cwd: string,
  deps: RunDeps,
): Promise<boolean> {
  const configPath = path.resolve(
    cwd,
    getFlagStr("config", "").trim() || defaultStackConfigPath(cwd),
  );
  const relativeConfigPath = relativePath(cwd, configPath);
  const stdout = deps.stdout || console.log;
  if (!deps.question && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    stdout(
      [
        "AWS account stack config is not initialized.",
        "",
        `Create it with: control-plane aws-account config-init`,
        `Then edit:      ${relativeConfigPath}`,
        "",
        "For a one-off check, rerun with --domain <domain>.",
      ].join("\n"),
    );
    process.exitCode = 2;
    return false;
  }

  stdout(
    [
      "AWS account stack config is not initialized.",
      "",
      `I can generate ${relativeConfigPath} now, ask for the domain, and continue this command.`,
      "The generated file contains no secret values.",
      "",
    ].join("\n"),
  );
  const accepted = await askAwsAccountQuestion(`Generate ${relativeConfigPath} now? [y/N] `, deps);
  if (!/^(y|yes)$/i.test(accepted.trim())) {
    stdout(`Skipped config generation. Run control-plane aws-account config-init when ready.`);
    process.exitCode = 2;
    return false;
  }
  const domain = (
    await askAwsAccountQuestion("Domain for this control-plane stack: ", deps)
  ).trim();
  if (!domain) {
    throw new Error(
      `config generation needs a domain. Rerun control-plane aws-account config-init --domain <domain>, then retry this command.`,
    );
  }
  const promptDeps = { ...deps, configInitValues: { domain } };
  if (await pathExists(configPath)) {
    const existing = await readConfigFile(configPath);
    await writeStackConfig(configPath, buildStackConfigValues(existing, promptDeps));
    stdout(["AWS account stack config updated", "", `Path: ${relativeConfigPath}`].join("\n"));
  } else {
    await writeStackConfig(configPath, buildStackConfigValues({}, promptDeps));
    stdout(["AWS account stack config written", "", `Path: ${relativeConfigPath}`].join("\n"));
  }
  stdout("");
  stdout(`Continuing with ${relativeConfigPath}...`);
  return true;
}

async function askAwsAccountQuestion(prompt: string, deps: RunDeps): Promise<string> {
  if (deps.question) return await deps.question(prompt);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

export async function initStackConfig(cwd: string, deps: RunDeps): Promise<void> {
  const configPath = path.resolve(
    cwd,
    getFlagStr("config", "").trim() || defaultStackConfigPath(cwd),
  );
  if ((await pathExists(configPath)) && !getFlagBool("force")) {
    throw new Error(
      `stack config already exists: ${relativePath(cwd, configPath)}. Edit that file, pass --config <path> for another location, or rerun config-init with --force to overwrite it.`,
    );
  }
  const values = buildStackConfigValues({}, deps);
  await writeStackConfig(configPath, values);
  (deps.stdout || console.log)(
    [
      "AWS account stack config written",
      "",
      `Path: ${relativePath(cwd, configPath)}`,
      "",
      "Next:",
      `  Edit ${relativePath(cwd, configPath)} and fill "domain".`,
      "  Run sprinkleref --init-local to create clone-local coordinate placeholders.",
      "  Or export SUPABASE_ACCESS_TOKEN=<token> in the setup shell for this run.",
      "  control-plane aws-account check",
      "",
      "The check/bootstrap commands load this canonical file automatically.",
      "Pass --config <path> only when using a different file.",
    ].join("\n"),
  );
}

async function writeStackConfig(
  configPath: string,
  values: Record<string, unknown>,
): Promise<void> {
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, renderStackConfigFile(values), "utf8");
}
