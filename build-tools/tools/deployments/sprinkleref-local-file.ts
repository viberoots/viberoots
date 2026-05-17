#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SprinkleRefStore } from "./sprinkleref-types";

type Store = Record<string, string>;

export class SprinkleRefLocalFileStore implements SprinkleRefStore {
  private readonly file: string;

  constructor(file: string) {
    this.file = path.resolve(file);
  }

  describe() {
    return `local-file ${this.file}`;
  }

  async has(ref: string) {
    return Object.prototype.hasOwnProperty.call(await this.readStore(), ref);
  }

  async read(ref: string) {
    return (await this.readStore())[ref];
  }

  async add(ref: string, value: string) {
    const store = await this.readStore();
    if (Object.prototype.hasOwnProperty.call(store, ref)) throw new Error(`${ref} already exists`);
    store[ref] = value;
    await this.writeStore(store);
  }

  async update(ref: string, value: string) {
    const store = await this.readStore();
    if (!Object.prototype.hasOwnProperty.call(store, ref)) throw new Error(`${ref} is missing`);
    store[ref] = value;
    await this.writeStore(store);
  }

  async remove(ref: string) {
    const store = await this.readStore();
    if (!Object.prototype.hasOwnProperty.call(store, ref)) throw new Error(`${ref} is missing`);
    delete store[ref];
    await this.writeStore(store);
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

  private async writeStore(store: Store) {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await fs.chmod(path.dirname(this.file), 0o700).catch(() => undefined);
    await fs.writeFile(this.file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(this.file, 0o600);
  }
}
