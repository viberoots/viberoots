import type { CredentialSink } from "./infisical-iac-bootstrap-types";
import { createSprinkleRefStore } from "./sprinkleref-store";
import type { SprinkleRefBackendConfig } from "./sprinkleref-types";

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

export function createSprinkleRefCredentialSink(
  category: string,
  backend: SprinkleRefBackendConfig,
  opts: { platform?: NodeJS.Platform } = {},
) {
  return new SprinkleRefCredentialSink(category, createSprinkleRefStore(backend, opts));
}
