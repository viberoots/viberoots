import path from "node:path";
import { getFlagStr } from "../lib/cli";
import {
  cliSource,
  defaultSource,
  parseStackField,
  resolveStackRef,
  type StackInputResolution,
  type StackInputSource,
} from "./aws-account-inputs";
import type { AwsAccountConfig } from "./aws-account-types";
import { readProjectConfig, redactedProjectConfigOverrides } from "./project-config";
import {
  assertNoOperatorSupabasePlanInput,
  assertNoSupabaseAccessTokenRefCliInputs,
  defaultStackConfigPath,
  pathExists,
  readConfigFile,
  relativePath,
  sanitizeStateName,
  strFlag,
  stringValue,
} from "./aws-account-utils";

export async function readAwsAccountConfig(cwd: string): Promise<AwsAccountConfig> {
  const configPath = getFlagStr("config", "").trim();
  const canonicalConfigPath = defaultStackConfigPath(cwd);
  let loadedConfigPath = configPath ? path.resolve(cwd, configPath) : "";
  let fromFile = loadedConfigPath ? await readConfigFile(loadedConfigPath) : {};
  const explicitEvidenceDirFlag = getFlagStr("evidence-dir", "").trim();
  if (!configPath && explicitEvidenceDirFlag) {
    const storedInputsPath = path.resolve(cwd, explicitEvidenceDirFlag, "inputs.json");
    if (await pathExists(storedInputsPath)) {
      loadedConfigPath = storedInputsPath;
      fromFile = await readConfigFile(storedInputsPath);
    }
  }
  if (!loadedConfigPath && (await pathExists(canonicalConfigPath))) {
    loadedConfigPath = canonicalConfigPath;
    fromFile = await readConfigFile(canonicalConfigPath);
  }
  assertNoOperatorSupabasePlanInput(fromFile);
  assertNoSupabaseAccessTokenRefCliInputs();
  const stackName = strFlag(
    "stack",
    strFlag("environment", stringValue(fromFile, "stackName", "control")),
  );
  const region = strFlag("region", stringValue(fromFile, "region", "us-east-1"));
  const inputSources: Record<string, StackInputSource> = {};
  const inputErrors: Record<string, string> = {};
  const domainInput = await resolveConfigInput(cwd, fromFile, "domain", {
    flag: "domain",
    fallback: "",
  });
  inputSources.domain = domainInput.source;
  const domain = domainInput.value || "";
  const explicitEvidenceDir = strFlag("evidence-dir", stringValue(fromFile, "evidenceDir", ""));
  if (!domain && !explicitEvidenceDir) {
    throw new Error(
      `aws-account needs stack identity. For a first run, add --domain <domain> to the command, run config-init and fill "domain": "..." in ${relativePath(cwd, canonicalConfigPath)}, or set "domain": "..." in the file passed with --config. For an existing run, pass --evidence-dir <dir> so the command can read inputs.json.`,
    );
  }
  const service = strFlag("service", stringValue(fromFile, "service", "deploy"));
  const authService = strFlag("auth-service", stringValue(fromFile, "authService", "auth"));
  const privateDbService = strFlag(
    "private-db-service",
    stringValue(fromFile, "privateDbService", "db"),
  );
  const serviceHost = strFlag(
    "service-host",
    stringValue(fromFile, "serviceHost", `${service}.${stackName}.${domain}`),
  );
  const authHost = strFlag(
    "auth-host",
    stringValue(fromFile, "authHost", `${authService}.${stackName}.${domain}`),
  );
  const privateDbHost = strFlag(
    "private-db-host",
    stringValue(fromFile, "privateDbHost", `${privateDbService}.${stackName}.${domain}`),
  );
  const evidenceDir = strFlag(
    "evidence-dir",
    stringValue(
      fromFile,
      "evidenceDir",
      explicitEvidenceDir || `buck-out/aws-account/${stackName}-${domain}`,
    ),
  );
  const stateNameSuffix = sanitizeStateName(`${stackName}-${domain || "unknown"}`);
  const stateBucketName = strFlag(
    "state-bucket-name",
    stringValue(
      fromFile,
      "stateBucketName",
      `deployment-control-plane-${stateNameSuffix}-tofu-state`,
    ),
  );
  const stateLockTableName = strFlag(
    "state-lock-table-name",
    stringValue(
      fromFile,
      "stateLockTableName",
      `deployment-control-plane-${stateNameSuffix}-tofu-locks`,
    ),
  );
  const backendStateKey = strFlag(
    "backend-state-key",
    stringValue(fromFile, "backendStateKey", "aws-foundation/deployment-control-plane.tfstate"),
  );
  const supabaseRegion = strFlag(
    "supabase-region",
    stringValue(fromFile, "supabaseRegion", region),
  );
  const supabaseAccessTokenEnv = strFlag(
    "supabase-access-token-env",
    stringValue(fromFile, "supabaseAccessTokenEnv", "SUPABASE_ACCESS_TOKEN"),
  );
  const supabaseApiBaseUrl = strFlag(
    "supabase-api-base-url",
    stringValue(fromFile, "supabaseApiBaseUrl", "https://api.supabase.com"),
  ).replace(/\/+$/, "");
  const awsAccount = await resolveConfigInput(cwd, fromFile, "awsAccountId", {
    flag: "aws-account-id",
    alternateFlag: "expected-aws-account-id",
  });
  const awsOrg = await resolveConfigInput(cwd, fromFile, "awsOrganizationId", {
    flag: "aws-organization-id",
  });
  const supabaseOrg = await resolveConfigInput(cwd, fromFile, "supabaseOrgId", {
    flag: "supabase-org-id",
  });
  const supabaseProject = await resolveConfigInput(cwd, fromFile, "supabaseProjectRef", {
    flag: "supabase-project-ref",
  });
  const supabaseToken = parseStackField(fromFile, "supabaseAccessToken", { secret: true });
  inputSources.awsAccountId = awsAccount.source;
  inputSources.awsOrganizationId = awsOrg.source;
  inputSources.supabaseOrgId = supabaseOrg.source;
  inputSources.supabaseProjectRef = supabaseProject.source;
  inputSources.supabaseAccessToken = supabaseToken.source;
  recordInputError(inputErrors, "awsAccountId", awsAccount);
  recordInputError(inputErrors, "awsOrganizationId", awsOrg);
  recordInputError(inputErrors, "supabaseOrgId", supabaseOrg);
  recordInputError(inputErrors, "supabaseProjectRef", supabaseProject);
  recordInputError(inputErrors, "supabaseAccessToken", supabaseToken);
  const localOverrides = redactedProjectConfigOverrides(
    (await readProjectConfig(cwd)).overrides,
  ).sort((a, b) => a.path.localeCompare(b.path));
  if (process.env.VBR_DISALLOW_LOCAL_OVERRIDES === "1" && localOverrides.length > 0) {
    throw new Error(
      `local project config overrides are disabled: ${localOverrides.map((entry) => entry.path).join(", ")}`,
    );
  }
  return {
    stackName,
    region,
    domain: domain || "unknown",
    service,
    authService,
    privateDbService,
    serviceHost,
    authHost,
    privateDbHost,
    evidenceDir,
    stateBucketName,
    stateLockTableName,
    backendStateKey,
    awsAccountId: awsAccount.value || undefined,
    awsOrganizationId: awsOrg.value || undefined,
    expectedAwsRoleArn:
      strFlag("expected-aws-role-arn", stringValue(fromFile, "expectedAwsRoleArn", "")) ||
      undefined,
    supabaseOrgId: supabaseOrg.value || undefined,
    supabaseProjectRef: supabaseProject.value || undefined,
    supabaseRegion,
    supabaseAccessTokenEnv,
    supabaseAccessToken: supabaseToken,
    supabaseApiBaseUrl,
    inputSources,
    inputErrors,
    localOverrides,
  };
}

function recordInputError(
  inputErrors: Record<string, string>,
  key: string,
  input: StackInputResolution,
) {
  if (input.error) inputErrors[key] = input.error;
}

async function resolveConfigInput(
  cwd: string,
  fromFile: Record<string, unknown>,
  key: string,
  opts: { flag: string; alternateFlag?: string; fallback?: string },
): Promise<StackInputResolution> {
  const flagValue =
    (opts.alternateFlag ? strFlag(opts.alternateFlag, "") : "") || strFlag(opts.flag, "");
  if (flagValue) return { value: flagValue, source: cliSource() };
  const parsed = parseStackField(fromFile, key);
  if (parsed.value || !parsed.ref) {
    if (!parsed.value && opts.fallback) return { value: opts.fallback, source: defaultSource() };
    return parsed;
  }
  return await resolveStackRef(cwd, parsed.ref, {
    category: parsed.category,
    categoryExplicit: Boolean(parsed.category),
  });
}
