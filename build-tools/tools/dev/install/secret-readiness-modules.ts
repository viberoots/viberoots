import path from "node:path";
import type { DeploymentBootstrapScope } from "../../deployments/infisical-iac-bootstrap-config";
import { PROJECT_SHARED_CONFIG_PATH } from "../../deployments/project-config";
import type { KeychainRunner } from "../../deployments/sprinkleref-keychain";

export type BootstrapArgs = Record<string, unknown> & {
  identityName: string;
  localCredentialFile: string;
  sprinkleCategory?: string;
  bootstrapCredentialScope?: string;
};

export type CredentialSink = {
  describe: () => string;
  has: (ref: string) => Promise<boolean>;
  read: (ref: string) => Promise<string>;
  write: (ref: string, value: string, overwrite?: boolean) => Promise<void>;
};

type MutableCredentialStore = CredentialSink & {
  add: (ref: string, value: string) => Promise<void>;
  update: (ref: string, value: string) => Promise<void>;
};

export type CredentialSinkSelection = {
  kind: string;
  configPath: string;
  category?: string;
};

type ReadinessModules = {
  LocalFileCredentialSink: new (file: string) => CredentialSink;
  createSprinkleRefStore: (
    backend: { backend: string; file?: string; service?: string },
    opts?: { platform?: NodeJS.Platform; keychainRunner?: KeychainRunner },
  ) => MutableCredentialStore;
  readDeploymentReviewedMetadata: (
    scope: DeploymentBootstrapScope,
    file?: string,
    workspaceRoot?: string,
  ) => Promise<{
    deploymentCredentials: Array<{ clientIdRef: string; clientSecretRef: string }>;
  }>;
  readSprinkleRefConfig: (configPath: string, cwd?: string) => Promise<unknown>;
  withBootstrapCredentialScope: (
    args: BootstrapArgs,
    workspaceRoot: string,
  ) => Promise<BootstrapArgs>;
  resolveBootstrapAccessCredentialSinkBackend: (
    config: unknown,
    category: string,
  ) => { backend: { backend: string; file?: string } };
};

export async function loadDeploymentReadinessModules() {
  const [
    config,
    identity,
    reviewedMetadata,
    sink,
    sprinkleRefGuard,
    sprinkleRefConfig,
    sprinkleRefStore,
  ] = await Promise.all([
    import("../../deployments/infisical-iac-bootstrap-config"),
    import("../../deployments/infisical-iac-bootstrap-identity"),
    import("../../deployments/infisical-iac-bootstrap-reviewed-metadata"),
    import("../../deployments/infisical-iac-bootstrap-sink"),
    import("../../deployments/sprinkleref-bootstrap-guard"),
    import("../../deployments/sprinkleref-config"),
    import("../../deployments/sprinkleref-store"),
  ]);
  return {
    DEFAULT_BOOTSTRAP_ARGS: config.DEFAULT_BOOTSTRAP_ARGS as BootstrapArgs,
    LocalFileCredentialSink: sink.LocalFileCredentialSink,
    createSprinkleRefStore: sprinkleRefStore.createSprinkleRefStore,
    readDeploymentReviewedMetadata: reviewedMetadata.readDeploymentReviewedMetadata,
    readSprinkleRefConfig: sprinkleRefConfig.readSprinkleRefConfig,
    repoBootstrapCredentialRefs: identity.repoBootstrapCredentialRefs,
    withBootstrapCredentialScope: config.withBootstrapCredentialScope,
    resolveBootstrapAccessCredentialSinkBackend:
      sprinkleRefGuard.resolveBootstrapAccessCredentialSinkBackend,
    resolveCredentialSinkSelection: sink.resolveCredentialSinkSelection,
  };
}

export async function sinkFromSelection(
  args: BootstrapArgs,
  selection: CredentialSinkSelection,
  repoRoot: string,
  modules: ReadinessModules,
  opts: { platform?: NodeJS.Platform; keychainRunner?: KeychainRunner } = {},
): Promise<CredentialSink> {
  if (selection.kind === "local-file") {
    return new modules.LocalFileCredentialSink(args.localCredentialFile);
  }
  const config = await modules.readSprinkleRefConfig(
    canonicalProjectConfigSelected(selection.configPath, repoRoot)
      ? ""
      : selection.configPath || "",
    repoRoot,
  );
  const resolved = modules.resolveBootstrapAccessCredentialSinkBackend(
    config,
    selection.category || args.sprinkleCategory || "bootstrap",
  );
  const store = modules.createSprinkleRefStore(
    absolutizeLocalFileBackend(resolved.backend, repoRoot),
    { platform: opts.platform, keychainRunner: opts.keychainRunner },
  );
  return {
    describe: () => store.describe(),
    has: (ref) => store.has(ref),
    read: (ref) => store.read(ref),
    write: async (ref, value, overwrite) => {
      if (overwrite && (await store.has(ref))) return await store.update(ref, value);
      await store.add(ref, value);
    },
  };
}

function canonicalProjectConfigSelected(configPath: string | undefined, repoRoot: string) {
  return Boolean(
    configPath && path.resolve(configPath) === path.resolve(repoRoot, PROJECT_SHARED_CONFIG_PATH),
  );
}

function absolutizeLocalFileBackend<T extends { backend: string; file?: string }>(
  backend: T,
  repoRoot: string,
): T {
  if (backend.backend !== "local-file" || !backend.file || path.isAbsolute(backend.file)) {
    return backend;
  }
  return { ...backend, file: path.join(repoRoot, backend.file) };
}
