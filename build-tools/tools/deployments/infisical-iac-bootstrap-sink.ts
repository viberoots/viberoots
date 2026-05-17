import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BootstrapArgs, CredentialSink } from "./infisical-iac-bootstrap-types";
import { readSprinkleRefConfig, resolveSprinkleRefBackend } from "./sprinkleref-config";
import { createSprinkleRefStore } from "./sprinkleref-store";
import type { SprinkleRefBackendConfig } from "./sprinkleref-types";

type Store = Record<string, string>;

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
  private readonly store: {
    describe(): string;
    has(ref: string): Promise<boolean>;
    read(ref: string): Promise<string | undefined>;
    add(ref: string, value: string): Promise<void>;
    update(ref: string, value: string): Promise<void>;
  };

  constructor(
    category: string,
    store: {
      describe(): string;
      has(ref: string): Promise<boolean>;
      read(ref: string): Promise<string | undefined>;
      add(ref: string, value: string): Promise<void>;
      update(ref: string, value: string): Promise<void>;
    },
  ) {
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
  description: string;
};

export async function resolveCredentialSinkSelection(
  args: BootstrapArgs,
  opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): Promise<CredentialSinkSelection> {
  const env = opts.env || process.env;
  if (args.credentialSink === "local-file") {
    return { kind: "local-file", backend: "local-file", description: args.localCredentialFile };
  }
  if (args.credentialSink === "macos-keychain") return macosSelection(opts.platform);
  if (args.credentialSink === "sprinkleref") return await sprinklerefSelection(args);
  if (env.SPRINKLEREF_CONFIG) return await sprinklerefSelection(args);
  return (opts.platform || process.platform) === "darwin"
    ? macosSelection(opts.platform)
    : { kind: "local-file", backend: "local-file", description: args.localCredentialFile };
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
      await resolvedSprinkleRefBackend(args),
    );
  }
  if (selection.kind === "macos-keychain")
    return createMacosCredentialSink(args, opts.platform || process.platform);
  return new LocalFileCredentialSink(args.localCredentialFile);
}

async function resolvedSprinkleRefBackend(args: BootstrapArgs) {
  const config = await readSprinkleRefConfig();
  const resolved = resolveSprinkleRefBackend(config, args.sprinkleCategory || "bootstrap");
  if (resolved.backend.backend === "infisical") {
    throw new Error("bootstrap credentials must not use an Infisical SprinkleRef backend");
  }
  return resolved;
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

async function sprinklerefSelection(args: BootstrapArgs): Promise<CredentialSinkSelection> {
  const resolved = await resolvedSprinkleRefBackend(args);
  return {
    kind: "sprinkleref",
    backend: resolved.backend.backend,
    category: resolved.category,
    description: `${resolved.category} -> ${resolved.backend.backend}`,
  };
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
