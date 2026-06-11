import type { StackInputResolution, StackInputSource } from "./aws-account-inputs";
import type { RedactedProjectConfigOverride } from "./project-config";

export const AWS_ACCOUNT_STATUS_SCHEMA = "aws-account-status@1";
export const AWS_ACCOUNT_INPUTS_SCHEMA = "aws-account-inputs@1";
export const AWS_ACCOUNT_STACK_CONFIG_FIELDS_WITHOUT_DEFAULTS = [
  "domain",
  "awsAccountId",
  "awsOrganizationId",
  "supabaseOrgId",
  "supabaseProjectRef",
  "supabaseAccessToken",
] as const;

export const PHASES = [
  "check-tools",
  "check-aws-login",
  "check-supabase",
  "bootstrap-state",
  "plan-foundation",
  "apply-foundation",
  "dns-migration",
  "verify-dns",
  "setup-profile",
  "validate-cutover",
  "remote-builds",
] as const;

export type Phase = (typeof PHASES)[number];
export type Subcommand =
  | "bootstrap"
  | "status"
  | "resume"
  | "check"
  | "setup-plan"
  | "evidence"
  | "clean"
  | "config-init";
export type PhaseState = "pending" | "passed" | "blocked" | "failed" | "manual";

export type AwsAccountConfig = {
  stackName: string;
  region: string;
  domain: string;
  service: string;
  authService: string;
  privateDbService: string;
  serviceHost: string;
  authHost: string;
  privateDbHost: string;
  evidenceDir: string;
  stateBucketName: string;
  stateLockTableName: string;
  backendStateKey: string;
  awsAccountId?: string;
  awsOrganizationId?: string;
  expectedAwsRoleArn?: string;
  supabaseOrgId?: string;
  supabaseProjectRef?: string;
  supabaseRegion: string;
  supabaseAccessTokenEnv: string;
  supabaseAccessToken?: StackInputResolution;
  supabaseApiBaseUrl: string;
  inputSources: Record<string, StackInputSource>;
  inputErrors: Record<string, string>;
  localOverrides: RedactedProjectConfigOverride[];
};

export type SupabaseTokenResolution = {
  token?: string;
  metadata: Record<string, unknown>;
  error?: string;
};

export type PhaseRecord = {
  state: PhaseState;
  message: string;
  evidence?: string;
  checkedAt?: string;
  missingConfigFields?: MissingConfigField[];
  resolvedInputSources?: Record<string, StackInputSource>;
};

export type MissingConfigField = {
  field: string;
  valueHint: string;
  destination?:
    | "stack-config"
    | "project-shared-config"
    | "project-local-config"
    | "secret-backend"
    | "bootstrap-category";
  ref?: string;
  category?: string;
  note?: string;
};

export type AwsAccountStatus = {
  schemaVersion: typeof AWS_ACCOUNT_STATUS_SCHEMA;
  updatedAt: string;
  stackName: string;
  domain: string;
  evidenceDir: string;
  localOverrides: RedactedProjectConfigOverride[];
  phases: Record<Phase, PhaseRecord>;
  nextPhase?: Phase;
};

export type CommandRunner = (
  file: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;
export type ToolResolver = (tool: string) => string;
export type HttpFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export type RunDeps = {
  now?: () => Date;
  commandRunner?: CommandRunner;
  env?: NodeJS.ProcessEnv;
  httpFetch?: HttpFetch;
  toolResolver?: ToolResolver;
  cwd?: string;
  stdout?: (text: string) => void;
  question?: (prompt: string) => Promise<string>;
  configInitValues?: Partial<Record<string, string>>;
};
