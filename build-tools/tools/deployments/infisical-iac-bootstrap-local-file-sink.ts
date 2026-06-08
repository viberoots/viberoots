import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CredentialSink } from "./infisical-iac-bootstrap-types";

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
