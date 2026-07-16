export const PROJECT_ENFORCEMENT_PER_TEST_TIMEOUT_SECS = 30;
export const PROJECT_ENFORCEMENT_OVERALL_TIMEOUT_SECS = 60;

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
