export const DEPLOYMENT_SOURCE_FILE_EXTENSIONS = new Set([
  ".bzl",
  ".ts",
  ".tsx",
  ".js",
  ".json",
  ".jsonc",
  ".jinja",
]);

const NEGATION =
  /\b(?:not|never|without|instead|reject|rejected|no longer|do not|must not|is not|are not|rather than)\b/i;
export const STALE_BRANCH_REQUIREMENT =
  /\b(?:allowed_refs|source_ref_policy|promotion|promote|admission|source authority|source ref)[^\n]*(?:^|[^A-Za-z0-9_./-])(?:refs\/heads\/)?env\/(?:<family>|[A-Za-z0-9_.-]+)\/(?:<stage>|[A-Za-z0-9_.-]+)(?=$|[^A-Za-z0-9_./-])/i;
const RELEASE_POINTER_AUTHORITY =
  /\brelease[- ]pointer[^\n]*(?:authoritative|source of truth|runtime deployment input)\b/i;
const STAGE_BRANCHES_FIELD = "stage" + "_branches";

export function scanDeploymentEnvironmentBranchText(relPath: string, text: string): string[] {
  const errors: string[] = [];
  if (/\bstage_branches(?:_required)?\b/.test(text)) {
    errors.push(`${relPath}: must not expose ${STAGE_BRANCHES_FIELD} in active deployment files`);
  }
  for (const [index, line] of text.split(/\r?\n/g).entries()) {
    if (NEGATION.test(line)) continue;
    if (STALE_BRANCH_REQUIREMENT.test(line)) {
      errors.push(`${relPath}:${index + 1}: environment branch must not be normal authority`);
    }
    if (RELEASE_POINTER_AUTHORITY.test(line)) {
      errors.push(`${relPath}:${index + 1}: release-pointer files must not be authoritative`);
    }
  }
  return errors;
}
