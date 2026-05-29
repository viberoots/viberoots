import type { VerifyDeploymentScopeMode } from "./requested-scope";

export function parseDeploymentTestScopeMode(raw: string | undefined): VerifyDeploymentScopeMode {
  const v = String(raw || "auto")
    .trim()
    .toLowerCase();
  if (v === "always") return "always";
  if (v === "never") return "never";
  return "auto";
}

export function allTestsRequested(env: NodeJS.ProcessEnv): boolean {
  const raw = String(env.ALL_TESTS || "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
