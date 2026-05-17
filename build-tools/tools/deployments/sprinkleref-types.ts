#!/usr/bin/env zx-wrapper
export type SprinkleRefBackendKind =
  | "infisical"
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
  projectRef?: string;
  defaultEnvironment?: string;
  defaultPath?: string;
  clientIdEnv?: string;
  clientSecretEnv?: string;
  tokenEnv?: string;
  scope?: string;
  namePrefix?: string;
};

export type SprinkleRefConfigFile = {
  version: 1;
  extends?: string;
  defaultCategory?: string;
  categories?: Record<string, SprinkleRefBackendConfig>;
};

export type SprinkleRefConfig = {
  path?: string;
  defaultCategory: string;
  categories: Record<string, SprinkleRefBackendConfig>;
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
