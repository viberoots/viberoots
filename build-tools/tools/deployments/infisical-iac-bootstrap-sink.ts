import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BootstrapArgs, CredentialSink } from "./infisical-iac-bootstrap-types";
import { LocalFileCredentialSink } from "./infisical-iac-bootstrap-local-file-sink";
import { resolverConfigPath } from "./infisical-iac-bootstrap-preflight";
import { readSprinkleRefConfig } from "./sprinkleref-config";
import * as bootstrapGuard from "./sprinkleref-bootstrap-guard";
import { createSprinkleRefStore } from "./sprinkleref-store";
import { initLocalSprinkleRefValues, initSprinkleRefConfigs } from "./sprinkleref-templates";
import type { SprinkleRefBackendConfig } from "./sprinkleref-types";

export { LocalFileCredentialSink } from "./infisical-iac-bootstrap-local-file-sink";

type SprinkleRefWritableStore = {
  describe(): string;
  has(ref: string): Promise<boolean>;
  read(ref: string): Promise<string | undefined>;
  add(ref: string, value: string): Promise<void>;
  update(ref: string, value: string): Promise<void>;
};

class SprinkleRefCredentialSink implements CredentialSink {
  private readonly category: string;
  private readonly store: SprinkleRefWritableStore;

  constructor(category: string, store: SprinkleRefWritableStore) {
    this.category = category;
    this.store = store;
  }

  describe() {
    return `SprinkleRef ${this.category} ${this.store.describe()}`;
  }

  async has(ref: string) {
    return await this.store.has(ref);
  }

  async read(ref: string) {
    return await this.store.read(ref);
  }

  async write(ref: string, value: string, overwrite: boolean) {
    if (overwrite && (await this.store.has(ref))) return await this.store.update(ref, value);
    await this.store.add(ref, value);
  }
}

export type CredentialSinkSelection = {
  kind: "local-file" | "macos-keychain" | "sprinkleref";
  backend?: string;
  category?: string;
  configPath?: string;
  description: string;
};

export async function resolveCredentialSinkSelection(
  args: BootstrapArgs,
  opts: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    createMissingResolverConfig?: boolean;
    workspaceRoot?: string;
    configPath?: string;
  } = {},
): Promise<CredentialSinkSelection> {
  const env = opts.env || process.env;
  const createMissingResolverConfig =
    opts.createMissingResolverConfig ?? (!args.dryRun && args.mode === "repo");
  if (args.credentialSink === "local-file") {
    return { kind: "local-file", backend: "local-file", description: args.localCredentialFile };
  }
  if (args.credentialSink === "macos-keychain") return macosSelection(opts.platform);
  if (args.credentialSink === "sprinkleref") {
    return await sprinklerefSelection(args, opts, createMissingResolverConfig);
  }
  return await autoSprinkleRefSelection(args, opts, createMissingResolverConfig);
}

export async function createCredentialSink(
  args: BootstrapArgs,
  opts: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    workspaceRoot?: string;
    configPath?: string;
  } = {},
): Promise<CredentialSink> {
  const selection = await resolveCredentialSinkSelection(args, opts);
  if (args.credentialSink === "local-file")
    return new LocalFileCredentialSink(args.localCredentialFile);
  if (selection.kind === "sprinkleref") {
    return createSprinkleRefCredentialSinkFromBackend(
      selection.category || args.sprinkleCategory || "bootstrap",
      await resolvedSprinkleRefBackend(args, selection.configPath, opts.workspaceRoot),
    );
  }
  if (selection.kind === "macos-keychain")
    return createMacosCredentialSink(args, opts.platform || process.platform);
  return new LocalFileCredentialSink(args.localCredentialFile);
}

async function resolvedSprinkleRefBackend(
  args: BootstrapArgs,
  configPath?: string,
  workspaceRoot?: string,
) {
  const config = await readSprinkleRefConfig(configPath, workspaceRoot);
  return bootstrapGuard.resolveBootstrapAccessCredentialSinkBackend(
    config,
    args.sprinkleCategory || "bootstrap",
  );
}

function createSprinkleRefCredentialSinkFromBackend(
  category: string,
  resolved: { backend: SprinkleRefBackendConfig },
) {
  return new SprinkleRefCredentialSink(category, createSprinkleRefStore(resolved.backend));
}

function createMacosCredentialSink(args: BootstrapArgs, platform: NodeJS.Platform) {
  macosSelection(platform);
  return new SprinkleRefCredentialSink(
    args.sprinkleCategory || "bootstrap",
    createSprinkleRefStore(
      { backend: "macos-keychain", service: "viberoots-bootstrap" },
      { platform },
    ),
  );
}

async function sprinklerefSelection(
  args: BootstrapArgs,
  opts: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    workspaceRoot?: string;
    configPath?: string;
  },
  createMissingResolverConfig = true,
): Promise<CredentialSinkSelection> {
  const configPath = await ensureResolverConfigPath(opts, createMissingResolverConfig);
  if (!configPath) return starterResolverSelection(args, opts.platform, opts.workspaceRoot);
  const resolved = await resolvedSprinkleRefBackend(args, configPath, opts.workspaceRoot);
  return {
    kind: "sprinkleref",
    backend: resolved.backend.backend,
    category: resolved.category,
    configPath,
    description: `${resolved.category} -> ${resolved.backend.backend}`,
  };
}

async function autoSprinkleRefSelection(
  args: BootstrapArgs,
  opts: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    workspaceRoot?: string;
    configPath?: string;
  },
  createMissingResolverConfig = true,
) {
  const configPath = await ensureResolverConfigPath(opts, createMissingResolverConfig);
  if (!configPath) return starterResolverSelection(args, opts.platform, opts.workspaceRoot);
  const resolved = await resolvedSprinkleRefBackend(args, configPath, opts.workspaceRoot);
  return {
    kind: "sprinkleref" as const,
    backend: resolved.backend.backend,
    category: resolved.category,
    configPath,
    description: `${resolved.category} -> ${resolved.backend.backend}`,
  };
}

function starterResolverSelection(
  args: BootstrapArgs,
  platform = process.platform,
  workspaceRoot = process.cwd(),
) {
  const backend = platform === "darwin" ? "macos-keychain" : "local-file";
  const category = args.sprinkleCategory || "bootstrap";
  return {
    kind: "sprinkleref" as const,
    backend,
    category,
    configPath: resolverConfigPath(path.join(workspaceRoot, "projects", "config")),
    description: `${category} -> ${backend} (starter config not created during dry-run)`,
  };
}

async function ensureResolverConfigPath(
  opts: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    workspaceRoot?: string;
    configPath?: string;
  },
  createMissingResolverConfig = true,
) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  if (env.SPRINKLEREF_CONFIG) {
    await bootstrapGuard.assertBootstrapResolverConfigExists(env.SPRINKLEREF_CONFIG);
    return env.SPRINKLEREF_CONFIG;
  }
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const selected =
    opts.configPath || resolverConfigPath(path.join(workspaceRoot, "projects", "config"));
  try {
    await fs.access(selected);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (!createMissingResolverConfig) return undefined;
    await initSprinkleRefConfigs({ dir: path.dirname(selected), platform, mode: "create" });
    await initLocalSprinkleRefValues(workspaceRoot);
  }
  return selected;
}

function macosSelection(platform = process.platform): CredentialSinkSelection {
  if (platform !== "darwin") {
    throw new Error(
      "macos-keychain credential sink requires macOS; use --credential-sink local-file or configure SPRINKLEREF_CONFIG for a local-file bootstrap category",
    );
  }
  return {
    kind: "macos-keychain",
    backend: "macos-keychain",
    category: "bootstrap",
    description: "viberoots-bootstrap",
  };
}
