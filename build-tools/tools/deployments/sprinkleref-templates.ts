#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { SprinkleRefConfigFile } from "./sprinkleref-types";

const MAIN_INFISICAL = {
  backend: "infisical" as const,
  host: "https://us.infisical.com",
  projectId: "pleomino-project-id",
  defaultEnvironment: "staging",
  defaultPath: "/",
  clientIdEnv: "INFISICAL_MACHINE_IDENTITY_CLIENT_ID",
  clientSecretEnv: "INFISICAL_MACHINE_IDENTITY_CLIENT_SECRET",
};

export function sprinkleRefStarterConfigs(platform = process.platform) {
  const bootstrap =
    platform === "darwin"
      ? { backend: "macos-keychain" as const, service: "viberoots-bootstrap" }
      : { backend: "local-file" as const, file: ".local/infisical/bootstrap/credentials.json" };
  const base: SprinkleRefConfigFile = {
    version: 1,
    defaultCategory: "main",
    categories: { main: MAIN_INFISICAL },
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
      categories: { bootstrap },
    },
  };
}

export async function initSprinkleRefConfigs(opts: { dir: string; platform?: NodeJS.Platform }) {
  await fs.mkdir(opts.dir, { recursive: true });
  const configs = sprinkleRefStarterConfigs(opts.platform || os.platform());
  const written: string[] = [];
  for (const [name, config] of Object.entries(configs)) {
    const file = path.join(opts.dir, name);
    await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
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
