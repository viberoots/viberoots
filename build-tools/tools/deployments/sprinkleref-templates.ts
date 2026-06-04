#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { starterInfisicalProfile } from "./infisical-iac-bootstrap-profile-kind";
import type { SprinkleRefConfigFile } from "./sprinkleref-types";
import { LOCAL_VALUES_PATH } from "./aws-account-inputs";

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
      "infisical-control": { ...starterInfisicalProfile(), defaultEnvironment: "prod" },
    },
    categories: {
      main: { profile: "infisical-default" },
      control: { profile: "infisical-control" },
    },
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
    "selected.json": {
      version: 1,
      extends: "./base.json",
      defaultCategory: "control",
      categories: {
        bootstrap,
        main: { profile: "infisical-default" },
        control: { profile: "infisical-control" },
      },
    },
    "selected.local.json": {
      version: 1,
      extends: "./selected.json",
      defaultCategory: "control",
      categories: {},
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

export async function initLocalSprinkleRefValues(cwd: string) {
  const file = path.resolve(cwd, LOCAL_VALUES_PATH);
  const existing = await readExistingLocalValues(file);
  const next = mergeLocalValueDefaults(existing);
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
    throw new Error(`invalid local SprinkleRef values JSON: ${LOCAL_VALUES_PATH}`);
  }
}

function mergeLocalValueDefaults(existing: Record<string, unknown>) {
  const root = { ...existing, schemaVersion: "sprinkleref-values@1" };
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
