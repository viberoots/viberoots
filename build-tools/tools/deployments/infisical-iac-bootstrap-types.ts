export type InfisicalHost = "us" | "eu" | string;

export type BootstrapArgs = {
  mode: "repo" | "deployment";
  target?: string;
  apiUrl: string;
  cliDomain: string;
  hostOverride?: boolean;
  organizationId?: string;
  orgName?: string;
  identityName: string;
  orgRole: "no-access" | "member" | "admin";
  accessTokenEnv: string;
  infisicalBin: string;
  noLogin: boolean;
  forceLogin: boolean;
  yes: boolean;
  dryRun: boolean;
  withoutDeployments: boolean;
  tofuDir: string;
  noTofuApply: boolean;
  tofuPlanFile?: string;
  rotateBootstrapCredentials: boolean;
  rotateDeploymentCredentials: boolean;
  forceOverwriteLocalCredentials: boolean;
  credentialSink: "auto" | "local-file" | "macos-keychain" | "sprinkleref";
  localCredentialFile: string;
  sprinkleCategory: string;
  clientSecretTtl: number;
  accessTokenTtl: number;
};

export type Organization = {
  id: string;
  name: string;
};

export type Identity = {
  id: string;
  name: string;
};

export type BootstrapCredential = {
  clientId: string;
  clientSecret: string;
};

export type CommandRunner = (opts: {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  capture?: boolean;
}) => string;

export type CredentialSink = {
  has(ref: string): Promise<boolean>;
  read(ref: string): Promise<string | undefined>;
  write(ref: string, value: string, overwrite: boolean): Promise<void>;
  describe(): string;
};

export type DeploymentCredentialRef = {
  stage: string;
  identityId: string;
  identityName: string;
  clientIdRef: string;
  clientSecretRef: string;
  clientIdFileName?: string;
  clientSecretFileName?: string;
};

export type DeploymentRuntimeMetadata = {
  siteUrl?: string;
  projectName?: string;
  projectId?: string;
  projectSlug?: string;
  secretPath?: string;
  cloudflareSecretName?: string;
  environments?: Record<string, { slug?: string }>;
  deploymentCredentials?: DeploymentCredentialRef[];
};

export type DeploymentCredentialLifecycleResult = {
  stage: string;
  identityId: string;
  identityName: string;
  clientIdRef: string;
  clientSecretRef: string;
  status: "preserved" | "rotated";
};

export type TofuDeploymentRuntimeStage = {
  site_url?: string;
  project_name?: string;
  project_slug?: string;
  project_id?: string;
  environment?: string;
  secret_path?: string;
  machine_identity_id?: string;
  machine_identity_name?: string;
  client_id_file_name?: string;
  client_secret_file_name?: string;
  cloudflare_secret_name?: string;
  preferred_credential_source?: string;
};

export type TofuDeploymentRuntimeMetadata = Record<string, TofuDeploymentRuntimeStage>;
