#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { starterInfisicalProfile } from "./infisical-iac-bootstrap-profile-kind";
import type { SprinkleRefConfigFile } from "./sprinkleref-types";

const VAULT_DEFAULT = {
  backend: "vault" as const,
  addressEnv: "VBR_VAULT_ADDR",
  tokenEnv: "VBR_VAULT_TOKEN",
  mount: "secret",
  defaultPath: "/deployments",
};

export function sprinkleRefStarterConfigs(platform = process.platform) {
  const bootstrap =
    platform === "darwin"
      ? { backend: "macos-keychain" as const, service: "viberoots-bootstrap" }
      : { backend: "local-file" as const, file: ".local/infisical/bootstrap/credentials.json" };
  const base: SprinkleRefConfigFile = {
    version: 1,
    defaultCategory: "main",
    profiles: {
      "vault-default": VAULT_DEFAULT,
      "infisical-default": starterInfisicalProfile(),
    },
    categories: { main: { profile: "infisical-default" } },
  };
  return {
    "base.json": base,
    "local.macos.json": localConfig("macos-keychain", { service: "viberoots-bootstrap" }),
    "local.file.json": localConfig("local-file", {
      file: ".local/infisical/bootstrap/credentials.json",
    }),
    "ci.github.json": ciConfig("github-actions", "VIBEROOTS_"),
    "ci.jenkins.json": ciConfig("jenkins", "VIBEROOTS_"),
    "ci.gitlab.json": ciConfig("gitlab-ci", "VIBEROOTS_"),
    "ci.bitbucket.json": ciConfig("bitbucket-pipelines", "VIBEROOTS_"),
    "selected.local.json": {
      version: 1,
      extends: "./base.json",
      defaultCategory: "main",
      categories: { bootstrap, main: { profile: "infisical-default" } },
    },
  };
}

export async function initSprinkleRefConfigs(opts: {
  dir: string;
  platform?: NodeJS.Platform;
  mode?: "create" | "overwrite";
}) {
  await fs.mkdir(opts.dir, { recursive: true });
  const configs = sprinkleRefStarterConfigs(opts.platform || os.platform());
  const written: string[] = [];
  for (const [name, config] of Object.entries(configs)) {
    const file = path.join(opts.dir, name);
    await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`, {
      flag: opts.mode === "overwrite" ? "w" : "wx",
    });
    written.push(file);
  }
  return written;
}

function localConfig(backend: "local-file" | "macos-keychain", fields: Record<string, string>) {
  return {
    version: 1 as const,
    extends: "./base.json",
    defaultCategory: "main",
    categories: { bootstrap: { backend, ...fields } },
  };
}

function ciConfig(
  backend: "github-actions" | "jenkins" | "gitlab-ci" | "bitbucket-pipelines",
  prefix: string,
) {
  return {
    version: 1 as const,
    extends: "./base.json",
    defaultCategory: "main",
    categories: { bootstrap: { backend, scope: "repository", namePrefix: prefix } },
  };
}
