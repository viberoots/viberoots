#!/usr/bin/env zx-wrapper
export type SprinkleRefBackendKind =
  | "infisical"
  | "vault"
  | "local-file"
  | "macos-keychain"
  | "github-actions"
  | "jenkins"
  | "gitlab-ci"
  | "bitbucket-pipelines";

export type SprinkleRefBackendConfig = {
  backend: SprinkleRefBackendKind;
  file?: string;
  service?: string;
  host?: string;
  projectId?: string;
  projectName?: string;
  projectRef?: string;
  generatedBy?: string;
  environment?: string;
  defaultEnvironment?: string;
  defaultPath?: string;
  clientIdEnv?: string;
  clientSecretEnv?: string;
  clientIdRef?: string;
  clientSecretRef?: string;
  tokenEnv?: string;
  projectIdEnv?: string;
  address?: string;
  addressEnv?: string;
  namespace?: string;
  mount?: string;
  scope?: string;
  namePrefix?: string;
};

export type SprinkleRefCategoryConfig =
  | SprinkleRefBackendConfig
  | {
      profile: string;
      environment?: string;
    };

export type SprinkleRefEnvironmentConfig = {
  infisicalEnvironment?: string;
};

export type SprinkleRefConfigFile = {
  version: 1;
  extends?: string;
  bootstrapScope?: string;
  repoInfisicalProjectName?: string;
  bootstrapKeychainServiceName?: string;
  repoKeychainServiceName?: string;
  environments?: Record<string, SprinkleRefEnvironmentConfig>;
  defaultCategory?: string;
  profiles?: Record<string, SprinkleRefBackendConfig>;
  categories?: Record<string, SprinkleRefCategoryConfig>;
};

export type SprinkleRefConfig = {
  path?: string;
  defaultCategory: string;
  bootstrapScope?: string;
  repoInfisicalProjectName?: string;
  bootstrapKeychainServiceName?: string;
  repoKeychainServiceName?: string;
  environments?: Record<string, SprinkleRefEnvironmentConfig>;
  profiles: Record<string, SprinkleRefBackendConfig>;
  categories: Record<string, SprinkleRefCategoryConfig>;
  overrides?: { path: string; sharedValue: unknown; localValue: unknown }[];
};

export type SprinkleRefOperation = "add" | "update" | "remove";

export type SprinkleRefStore = {
  describe(): string;
  has(ref: string): Promise<boolean>;
  read(ref: string): Promise<string | undefined>;
  add(ref: string, value: string): Promise<void>;
  update(ref: string, value: string): Promise<void>;
  remove(ref: string): Promise<void>;
};
