import path from "node:path";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { runManagedCommand } from "../../lib/managed-command";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import type { FixedSourceEntry } from "./cargo-fixed-sources";
import { languageUpdateTimeoutMs } from "../update-command/languages";

function tool(root: string, name: string): string {
  return ensureNixStoreToolPathSync(name, {
    PATH: path.join(canonicalArtifactToolsRoot(root), "bin"),
  });
}

async function checkedCommand(
  root: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const result = await runManagedCommand({
    command,
    args,
    cwd,
    env,
    timeoutMs: languageUpdateTimeoutMs(process.env),
  });
  if (!result.ok || result.interrupted) {
    throw new Error(`failed immutable Rust source command: ${path.basename(command)} ${args[0]}`);
  }
  return result.stdout.trim();
}

function isolatedCargoEnvironment(root: string, toolsBin: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("CARGO_") || ["RUSTC", "RUSTFLAGS", "RUSTUP_HOME"].includes(key)) {
      delete env[key];
    }
  }
  return {
    ...env,
    PATH: toolsBin,
    CARGO_HOME: path.join(root, ".viberoots/workspace/cargo-home"),
    CARGO_NET_OFFLINE: "true",
  };
}

function isolatedGitEnvironment(toolsBin: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_") || key.startsWith("SSH_")) delete env[key];
  }
  return {
    ...env,
    PATH: toolsBin,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function isolatedTarEnvironment(toolsBin: string): NodeJS.ProcessEnv {
  const env = { ...process.env, PATH: toolsBin };
  delete env.TAR_OPTIONS;
  delete env.GZIP;
  delete env.GZIP_BIN;
  return env;
}

type CommandObservation = {
  command: "cargo" | "git" | "nix" | "tar";
  env: NodeJS.ProcessEnv;
};

export function cargoSourceMaterialization(
  root: string,
  deps: { observeCommand?: (observation: CommandObservation) => void } = {},
): {
  materialize: (
    key: string,
    entry: FixedSourceEntry,
  ) => Promise<{ storePath: string; narHash: string }>;
  runGit: (command: string, args: string[], cwd: string) => Promise<string>;
} {
  const nix = tool(root, "nix");
  const git = tool(root, "git");
  const cargo = tool(root, "cargo");
  const tar = tool(root, "tar");
  const toolsBin = path.join(canonicalArtifactToolsRoot(root), "bin");
  const cargoEnv = isolatedCargoEnvironment(root, toolsBin);
  const gitEnv = isolatedGitEnvironment(toolsBin);
  const tarEnv = isolatedTarEnvironment(toolsBin);
  return {
    runGit: (command, args, cwd) => {
      const kind = command === "git" ? "git" : command === "cargo" ? "cargo" : "tar";
      const env = kind === "cargo" ? cargoEnv : kind === "git" ? gitEnv : tarEnv;
      deps.observeCommand?.({ command: kind, env: { ...env } });
      return checkedCommand(
        root,
        kind === "git" ? git : kind === "cargo" ? cargo : tar,
        args,
        cwd,
        env,
      );
    },
    materialize: async (key, entry) => {
      const name = `viberoots-cargo-${Buffer.from(key).toString("hex").slice(0, 24)}`;
      deps.observeCommand?.({ command: "nix", env: { ...process.env } });
      const storePath = await checkedCommand(
        root,
        nix,
        ["store", "add-path", "--name", name, entry.originPath],
        root,
      );
      const narHash = await checkedCommand(root, nix, ["hash", "path", "--sri", storePath], root);
      return { storePath, narHash };
    },
  };
}
