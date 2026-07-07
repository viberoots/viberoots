#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { starterInfisicalProfile } from "./infisical-iac-bootstrap-profile-kind";
import type { SprinkleRefConfigFile } from "./sprinkleref-types";
import { LOCAL_VALUES_PATH } from "./aws-account-inputs";
import { findRepoRoot } from "../lib/repo";

export const VAULT_DEFAULT = {
  backend: "vault" as const,
  addressEnv: "VBR_VAULT_ADDR",
  tokenEnv: "VBR_VAULT_TOKEN",
  mount: "secret",
  defaultPath: "/deployments",
};

export const MACOS_KEYCHAIN_MAIN_DEFAULT = {
  backend: "macos-keychain" as const,
  service: "viberoots-main",
};

export function sprinkleRefStarterConfigs(_platform = process.platform) {
  const shared = {
    schemaVersion: "viberoots-project-config@1",
    environments: {
      staging: { infisicalEnvironment: "staging" },
      prod: { infisicalEnvironment: "prod" },
    },
    runtimeHosts: {
      "local-macos": { backend: "macos-keychain", service: "viberoots-bootstrap" },
      "local-file": { backend: "local-file" },
      "github-actions": ciBackend("github-actions", "VIBEROOTS_"),
      jenkins: ciBackend("jenkins", "VIBEROOTS_"),
      "gitlab-ci": ciBackend("gitlab-ci", "VIBEROOTS_"),
      "bitbucket-pipelines": ciBackend("bitbucket-pipelines", "VIBEROOTS_"),
    },
    sprinkleref: {
      version: 1,
      defaultCategory: "control",
      profiles: {
        "vault-default": VAULT_DEFAULT,
        "infisical-default": starterInfisicalProfile(),
        "infisical-control": starterInfisicalProfile(),
      },
      categories: {
        main: { profile: "infisical-default", environment: "staging" },
        control: { profile: "infisical-control", environment: "prod" },
      },
    } satisfies SprinkleRefConfigFile,
  };
  return { "shared.json": shared };
}

export function starterRuntimeHost(platform = process.platform) {
  return platform === "darwin" ? "local-macos" : "local-file";
}

export function starterSprinkleRefConfig(): SprinkleRefConfigFile {
  return {
    version: 1,
    defaultCategory: "control",
    profiles: {
      "vault-default": VAULT_DEFAULT,
      "infisical-default": starterInfisicalProfile(),
      "infisical-control": starterInfisicalProfile(),
    },
    categories: {
      main: { profile: "infisical-default", environment: "staging" },
      control: { profile: "infisical-control", environment: "prod" },
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
    try {
      await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`, {
        flag: opts.mode === "overwrite" ? "w" : "wx",
      });
    } catch (error) {
      if (
        opts.mode !== "overwrite" &&
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        continue;
      }
      throw error;
    }
    written.push(file);
  }
  return written;
}

export async function initLocalSprinkleRefValues(cwd: string) {
  const workspaceRoot = await findRepoRoot(cwd);
  const file = path.resolve(workspaceRoot, LOCAL_VALUES_PATH);
  const existing = await readExistingLocalValues(file);
  const next = mergeLocalValueDefaults(existing, os.platform());
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return file;
}

async function readExistingLocalValues(file: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("local values root must be an object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw new Error(`invalid project local config JSON: ${LOCAL_VALUES_PATH}`);
  }
}

function mergeLocalValueDefaults(existing: Record<string, unknown>, platform: NodeJS.Platform) {
  const root = { ...existing, schemaVersion: "viberoots-project-local-config@1" };
  root.activeRuntimeHost ??= starterRuntimeHost(platform);
  const runtimeHosts = objectChild(root, "runtimeHosts");
  const localFile = objectChild(runtimeHosts, "local-file");
  localFile.backend ??= "local-file";
  localFile.file ??= ".local/infisical/bootstrap/credentials.json";
  const values = objectChild(root, "values");
  const control = objectChild(values, "control-plane");
  const aws = objectChild(control, "aws");
  const supabase = objectChild(control, "supabase");
  aws["account-id"] ??= "";
  aws["organization-id"] ??= "";
  supabase["org-id"] ??= "";
  supabase["project-ref"] ??= "";
  supabase["management-api-token"] ??= {
    ref: "secret://control-plane/supabase/management-api-token",
  };
  return root;
}

function objectChild(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = parent[key];
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  const child: Record<string, unknown> = {};
  parent[key] = child;
  return child;
}

function ciBackend(
  backend: "github-actions" | "jenkins" | "gitlab-ci" | "bitbucket-pipelines",
  prefix: string,
) {
  return { backend, scope: "repository", namePrefix: prefix };
}
