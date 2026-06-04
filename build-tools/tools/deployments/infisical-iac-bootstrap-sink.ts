import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BootstrapArgs, CredentialSink } from "./infisical-iac-bootstrap-types";
import { resolverConfigPath } from "./infisical-iac-bootstrap-preflight";
import { readSprinkleRefConfig } from "./sprinkleref-config";
import * as bootstrapGuard from "./sprinkleref-bootstrap-guard";
import { createSprinkleRefStore } from "./sprinkleref-store";
import { initLocalSprinkleRefValues, initSprinkleRefConfigs } from "./sprinkleref-templates";
import type { SprinkleRefBackendConfig } from "./sprinkleref-types";

type Store = Record<string, string>;
type SprinkleRefWritableStore = {
  describe(): string;
  has(ref: string): Promise<boolean>;
  read(ref: string): Promise<string | undefined>;
  add(ref: string, value: string): Promise<void>;
  update(ref: string, value: string): Promise<void>;
};

export class LocalFileCredentialSink implements CredentialSink {
  private readonly file: string;

  constructor(file: string) {
    this.file = path.resolve(file);
  }

  describe() {
    return `local secure sink ${this.file}`;
  }

  async has(ref: string) {
    const store = await this.readStore();
    return Boolean(store[ref]);
  }

  async read(ref: string) {
    const store = await this.readStore();
    return store[ref];
  }

  async write(ref: string, value: string, overwrite: boolean) {
    const store = await this.readStore();
    if (store[ref] && !overwrite) {
      throw new Error(
        `credential already exists for ${ref}; pass --force-overwrite-local-credentials to replace it`,
      );
    }
    store[ref] = value;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(this.file, 0o600);
  }

  private async readStore(): Promise<Store> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8")) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Store)
        : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }
}

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
    return await sprinklerefSelection(args, opts.platform, env, createMissingResolverConfig);
  }
  return await autoSprinkleRefSelection(args, opts.platform, env, createMissingResolverConfig);
}

export async function createCredentialSink(
  args: BootstrapArgs,
  opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): Promise<CredentialSink> {
  const selection = await resolveCredentialSinkSelection(args, opts);
  if (args.credentialSink === "local-file")
    return new LocalFileCredentialSink(args.localCredentialFile);
  if (selection.kind === "sprinkleref") {
    return createSprinkleRefCredentialSinkFromBackend(
      selection.category || args.sprinkleCategory || "bootstrap",
      await resolvedSprinkleRefBackend(args, selection.configPath),
    );
  }
  if (selection.kind === "macos-keychain")
    return createMacosCredentialSink(args, opts.platform || process.platform);
  return new LocalFileCredentialSink(args.localCredentialFile);
}

async function resolvedSprinkleRefBackend(args: BootstrapArgs, configPath?: string) {
  const config = await readSprinkleRefConfig(configPath);
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
  platform = process.platform,
  env = process.env,
  createMissingResolverConfig = true,
): Promise<CredentialSinkSelection> {
  const configPath = await ensureResolverConfigPath(platform, env, createMissingResolverConfig);
  if (!configPath) return starterResolverSelection(args, platform);
  const resolved = await resolvedSprinkleRefBackend(args, configPath);
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
  platform?: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
  createMissingResolverConfig = true,
) {
  const configPath = await ensureResolverConfigPath(platform, env, createMissingResolverConfig);
  if (!configPath) return starterResolverSelection(args, platform);
  const resolved = await resolvedSprinkleRefBackend(args, configPath);
  return {
    kind: "sprinkleref" as const,
    backend: resolved.backend.backend,
    category: resolved.category,
    configPath,
    description: `${resolved.category} -> ${resolved.backend.backend}`,
  };
}

function starterResolverSelection(args: BootstrapArgs, platform = process.platform) {
  const backend = platform === "darwin" ? "macos-keychain" : "local-file";
  const category = args.sprinkleCategory || "bootstrap";
  return {
    kind: "sprinkleref" as const,
    backend,
    category,
    configPath: resolverConfigPath(),
    description: `${category} -> ${backend} (starter config not created during dry-run)`,
  };
}

async function ensureResolverConfigPath(
  platform = process.platform,
  env = process.env,
  createMissingResolverConfig = true,
) {
  if (env.SPRINKLEREF_CONFIG) {
    await bootstrapGuard.assertBootstrapResolverConfigExists(env.SPRINKLEREF_CONFIG);
    return env.SPRINKLEREF_CONFIG;
  }
  const selected = resolverConfigPath();
  try {
    await fs.access(selected);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (!createMissingResolverConfig) return undefined;
    await initSprinkleRefConfigs({ dir: path.dirname(selected), platform, mode: "create" });
    await initLocalSprinkleRefValues(process.cwd());
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
