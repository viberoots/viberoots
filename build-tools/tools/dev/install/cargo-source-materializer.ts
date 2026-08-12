import path from "node:path";
import * as fsp from "node:fs/promises";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { runManagedCommand } from "../../lib/managed-command";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import type { FixedSourceEntry } from "./cargo-fixed-sources";
import {
  readCachedFixedSource,
  sharedCargoFixedSourceCacheRoot,
  writeCachedFixedSource,
} from "./cargo-fixed-source-cache";
import { languageUpdateTimeoutMs } from "../update-command/languages";
import { cargoCommandHome } from "./cargo-home";

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
    const tail = (value: string): string =>
      value.trim().split(/\r?\n/u).slice(-12).join("\n").slice(-2_000);
    const stdout = tail(result.stdout);
    const stderr = tail(result.stderr);
    throw new Error(
      [
        `failed immutable Rust source command: ${path.basename(command)} ${args.join(" ")}`,
        `exit=${result.code ?? "signal"} signal=${result.signal ?? "none"} timedOut=${result.timedOut} interrupted=${result.interrupted}`,
        stderr ? `stderr:\n${stderr}` : "",
        stdout ? `stdout:\n${stdout}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
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
    CARGO_HOME: cargoCommandHome(root, env),
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
  deferredMaterialization: {
    add: (
      key: string,
      entry: FixedSourceEntry,
    ) => Promise<{
      storePath: string;
    }>;
    hash: (storePaths: string[]) => Promise<string[]>;
  };
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
  const cacheRoot = sharedCargoFixedSourceCacheRoot(process.env);
  const isValidStorePath = async (storePath: string): Promise<boolean> => {
    return await fsp.access(storePath).then(
      () => true,
      () => false,
    );
  };
  const add = async (key: string, entry: FixedSourceEntry): Promise<{ storePath: string }> => {
    const name = `viberoots-cargo-${Buffer.from(key).toString("hex").slice(0, 24)}`;
    deps.observeCommand?.({ command: "nix", env: { ...process.env } });
    const storePath = await checkedCommand(
      root,
      nix,
      ["store", "add-path", "--name", name, entry.originPath],
      root,
    );
    return { storePath };
  };
  const hash = async (storePaths: string[]): Promise<string[]> => {
    if (storePaths.length === 0) return [];
    deps.observeCommand?.({ command: "nix", env: { ...process.env } });
    const stdout = await checkedCommand(root, nix, ["hash", "path", "--sri", ...storePaths], root);
    return stdout.split(/\r?\n/u).filter(Boolean);
  };
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
    deferredMaterialization: {
      lookup: (key, entry) => readCachedFixedSource(cacheRoot, key, entry, isValidStorePath),
      add,
      hash,
      store: (key, entry, value) => writeCachedFixedSource(cacheRoot, key, entry, value),
    },
    materialize: async (key, entry) => {
      const { storePath } = await add(key, entry);
      const [narHash] = await hash([storePath]);
      if (!narHash) throw new Error(`failed immutable Rust source hash: ${key}`);
      return { storePath, narHash };
    },
  };
}
