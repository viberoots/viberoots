import { hasFlag } from "../lib/cli";
import { CONTROL_PLANE_CONFIG_REFS } from "./aws-account-ref-schemes";
import {
  AWS_ACCOUNT_STACK_CONFIG_FIELDS_WITHOUT_DEFAULTS,
  type RunDeps,
} from "./aws-account-types";
import { sanitizeStateName, strFlag, stringValue } from "./aws-account-utils";

export function buildStackConfigValues(
  fromFile: Record<string, unknown>,
  deps: RunDeps,
): Record<string, unknown> {
  const initValue = (key: string, fallback: string): string =>
    deps.configInitValues?.[key]?.trim() || fallback;
  const values: Record<string, unknown> = {};
  const stackName = initValue(
    "stackName",
    strFlag("stack", strFlag("environment", stringValue(fromFile, "stackName", "control"))),
  );
  const region = initValue(
    "region",
    strFlag("region", stringValue(fromFile, "region", "us-east-1")),
  );
  const domain = initValue("domain", strFlag("domain", stringValue(fromFile, "domain", "")));
  const service = initValue(
    "service",
    strFlag("service", stringValue(fromFile, "service", "deploy")),
  );
  const authService = initValue(
    "authService",
    strFlag("auth-service", stringValue(fromFile, "authService", "auth")),
  );
  const privateDbService = initValue(
    "privateDbService",
    strFlag("private-db-service", stringValue(fromFile, "privateDbService", "db")),
  );
  const stateNameSuffix = sanitizeStateName(`${stackName}-${domain || "domain"}`);

  values.domain = domain;
  values.awsAccountId = initStructuredField(fromFile, "awsAccountId", [
    "expected-aws-account-id",
    "aws-account-id",
  ]);
  values.awsOrganizationId = initStructuredField(fromFile, "awsOrganizationId", [
    "aws-organization-id",
  ]);
  values.supabaseOrgId = initStructuredField(fromFile, "supabaseOrgId", ["supabase-org-id"]);
  values.supabaseProjectRef = initStructuredField(fromFile, "supabaseProjectRef", [
    "supabase-project-ref",
  ]);
  values.supabaseAccessToken = initStructuredField(fromFile, "supabaseAccessToken", []);

  addNonDefaultStackConfigValue(values, fromFile, "stackName", stackName, "control", [
    "stack",
    "environment",
  ]);
  addNonDefaultStackConfigValue(values, fromFile, "region", region, "us-east-1", ["region"]);
  addNonDefaultStackConfigValue(
    values,
    fromFile,
    "expectedAwsRoleArn",
    strFlag("expected-aws-role-arn", stringValue(fromFile, "expectedAwsRoleArn", "")),
    "",
    ["expected-aws-role-arn"],
  );
  addNonDefaultStackConfigValue(values, fromFile, "service", service, "deploy", ["service"]);
  addNonDefaultStackConfigValue(values, fromFile, "authService", authService, "auth", [
    "auth-service",
  ]);
  addNonDefaultStackConfigValue(values, fromFile, "privateDbService", privateDbService, "db", [
    "private-db-service",
  ]);
  addNonDefaultStackConfigValue(
    values,
    fromFile,
    "serviceHost",
    strFlag(
      "service-host",
      stringValue(fromFile, "serviceHost", domain ? `${service}.${stackName}.${domain}` : ""),
    ),
    domain ? `${service}.${stackName}.${domain}` : "",
    ["service-host"],
  );
  addNonDefaultStackConfigValue(
    values,
    fromFile,
    "authHost",
    strFlag(
      "auth-host",
      stringValue(fromFile, "authHost", domain ? `${authService}.${stackName}.${domain}` : ""),
    ),
    domain ? `${authService}.${stackName}.${domain}` : "",
    ["auth-host"],
  );
  addNonDefaultStackConfigValue(
    values,
    fromFile,
    "privateDbHost",
    strFlag(
      "private-db-host",
      stringValue(
        fromFile,
        "privateDbHost",
        domain ? `${privateDbService}.${stackName}.${domain}` : "",
      ),
    ),
    domain ? `${privateDbService}.${stackName}.${domain}` : "",
    ["private-db-host"],
  );
  addNonDefaultStackConfigValue(
    values,
    fromFile,
    "evidenceDir",
    strFlag(
      "evidence-dir",
      stringValue(
        fromFile,
        "evidenceDir",
        domain ? `buck-out/aws-account/${stackName}-${domain}` : "",
      ),
    ),
    domain ? `buck-out/aws-account/${stackName}-${domain}` : "",
    ["evidence-dir"],
  );
  addNonDefaultStackConfigValue(
    values,
    fromFile,
    "stateBucketName",
    strFlag(
      "state-bucket-name",
      stringValue(
        fromFile,
        "stateBucketName",
        domain ? `deployment-control-plane-${stateNameSuffix}-tofu-state` : "",
      ),
    ),
    domain ? `deployment-control-plane-${stateNameSuffix}-tofu-state` : "",
    ["state-bucket-name"],
  );
  addNonDefaultStackConfigValue(
    values,
    fromFile,
    "stateLockTableName",
    strFlag(
      "state-lock-table-name",
      stringValue(
        fromFile,
        "stateLockTableName",
        domain ? `deployment-control-plane-${stateNameSuffix}-tofu-locks` : "",
      ),
    ),
    domain ? `deployment-control-plane-${stateNameSuffix}-tofu-locks` : "",
    ["state-lock-table-name"],
  );
  addNonDefaultStackConfigValue(
    values,
    fromFile,
    "backendStateKey",
    strFlag(
      "backend-state-key",
      stringValue(fromFile, "backendStateKey", "aws-foundation/deployment-control-plane.tfstate"),
    ),
    "aws-foundation/deployment-control-plane.tfstate",
    ["backend-state-key"],
  );
  addNonDefaultStackConfigValue(
    values,
    fromFile,
    "supabaseRegion",
    strFlag("supabase-region", stringValue(fromFile, "supabaseRegion", region)),
    region,
    ["supabase-region"],
  );
  addNonDefaultStackConfigValue(
    values,
    fromFile,
    "supabaseAccessTokenEnv",
    strFlag(
      "supabase-access-token-env",
      stringValue(fromFile, "supabaseAccessTokenEnv", "SUPABASE_ACCESS_TOKEN"),
    ),
    "SUPABASE_ACCESS_TOKEN",
    ["supabase-access-token-env"],
  );
  addNonDefaultStackConfigValue(
    values,
    fromFile,
    "supabaseApiBaseUrl",
    strFlag(
      "supabase-api-base-url",
      stringValue(fromFile, "supabaseApiBaseUrl", "https://api.supabase.com"),
    ),
    "https://api.supabase.com",
    ["supabase-api-base-url"],
  );
  for (const field of AWS_ACCOUNT_STACK_CONFIG_FIELDS_WITHOUT_DEFAULTS) {
    values[field] ??= "";
  }
  return values;
}

function addNonDefaultStackConfigValue(
  values: Record<string, unknown>,
  fromFile: Record<string, unknown>,
  key: string,
  value: string,
  defaultValue: string,
  flags: string[],
): void {
  const explicit = Object.hasOwn(fromFile, key) || flags.some((flag) => hasFlag(flag));
  if (explicit && value !== defaultValue) values[key] = value;
}

function initStructuredField(
  fromFile: Record<string, unknown>,
  key: string,
  flags: string[],
): string | { ref: string; category?: string } {
  for (const flag of flags) {
    const value = strFlag(flag, "");
    if (value) {
      return value;
    }
  }
  if (Object.hasOwn(fromFile, key)) return fromFile[key] as string | { ref: string };
  const ref = defaultStackRef(key);
  return ref.startsWith("secret://") ? { ref, category: "control" } : { ref };
}

function defaultStackRef(key: string): string {
  const refs: Record<string, string> = {
    ...CONTROL_PLANE_CONFIG_REFS,
    supabaseAccessToken: "secret://control-plane/supabase/management-api-token",
  };
  return refs[key] || "";
}
