import { assertBackendNeutralRef } from "./sprinkleref-config";

export const CONTROL_PLANE_CONFIG_REFS: Record<string, string> = {
  awsAccountId: "config://control-plane/aws/account-id",
  awsOrganizationId: "config://control-plane/aws/organization-id",
  supabaseOrgId: "config://control-plane/supabase/org-id",
  supabaseProjectRef: "config://control-plane/supabase/project-ref",
};

export type StackRefOptions = {
  category?: string;
  categoryExplicit?: boolean;
  secret?: boolean;
  env?: NodeJS.ProcessEnv;
};

export function logicalRefPath(ref: string): string {
  return ref.slice(ref.indexOf("://") + "://".length);
}

export function assertStackRef(key: string, ref: string, secret: boolean): void {
  const scheme = ref.slice(0, ref.indexOf("://"));
  const allowed = secret ? ["secret"] : ["config", "runtime"];
  if (!allowed.includes(scheme)) {
    throw new Error(`${key} ref must use ${allowed.join(":// or ")}://`);
  }
  assertBackendNeutralRef(ref);
}
