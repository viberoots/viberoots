import {
  PROJECT_ENFORCEMENT_OVERALL_TIMEOUT_SECS,
  PROJECT_ENFORCEMENT_PER_TEST_TIMEOUT_SECS,
} from "../../lib/project-enforcement-timeouts";

export { PROJECT_ENFORCEMENT_OVERALL_TIMEOUT_SECS, PROJECT_ENFORCEMENT_PER_TEST_TIMEOUT_SECS };

export function exactTimeoutsForVerifyPass(
  passName: string,
): { perTest: number; overall: number } | undefined {
  return passName === "project-enforcement"
    ? {
        perTest: PROJECT_ENFORCEMENT_PER_TEST_TIMEOUT_SECS,
        overall: PROJECT_ENFORCEMENT_OVERALL_TIMEOUT_SECS,
      }
    : undefined;
}
