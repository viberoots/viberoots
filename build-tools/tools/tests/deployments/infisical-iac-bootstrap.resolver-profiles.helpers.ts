import assert from "node:assert/strict";
import * as fs from "node:fs/promises";

export const VAULT_PROFILE = {
  backend: "vault",
  addressEnv: "VBR_VAULT_ADDR",
  tokenEnv: "VBR_VAULT_TOKEN",
  mount: "secret",
  defaultPath: "/deployments",
};

export async function assertMissing(file: string) {
  await assert.rejects(() => fs.stat(file), /ENOENT/);
}
