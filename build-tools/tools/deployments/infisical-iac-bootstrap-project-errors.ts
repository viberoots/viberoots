import type { InfisicalRepoProject } from "./infisical-iac-bootstrap-profile-api";

export function repoProjectCreateFailureMessage(
  error: unknown,
  projectName: string,
  visibleProjects: InfisicalRepoProject[],
) {
  if (isPlanLimitError(error)) {
    return [
      "BOOTSTRAP ERROR: Infisical project setup failed.",
      `Infisical plan limit reached while creating repo project "${projectName}".`,
      "Reuse an existing Infisical secret-manager project instead.",
      visibleProjects.length
        ? `Candidate projects: ${visibleProjects.map(formatProject).join("; ")}`
        : "No existing secret-manager projects were visible to this login.",
      "Next: rerun with `i --bootstrap --infisical-project-name <existing-project-name>`, set VBR_INFISICAL_PROJECT_ID=<project-id>, or write that project id into the generated infisical-default profile in projects/config/shared.json.",
    ].join("\n");
  }
  return [
    "BOOTSTRAP ERROR: Infisical project setup failed.",
    `Could not create Infisical project "${projectName}" for repo bootstrap.`,
    errorMessage(error),
    "If the Infisical organization has reached its project/workspace limit, reuse an existing secret-manager project instead of creating a new one.",
    "Rerun with `i --bootstrap --infisical-project-name <existing-project-name>`, set the generated profile projectId in projects/config/shared.json, or export VBR_INFISICAL_PROJECT_ID before rerunning bootstrap.",
    visibleProjects.length
      ? `Visible projects: ${visibleProjects.map(formatProject).join("; ")}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isPlanLimitError(error: unknown) {
  return /plan limit reached|Upgrade plan to add more workspaces/i.test(errorMessage(error));
}

function formatProject(project: InfisicalRepoProject) {
  const slug = project.slug ? ` slug=${project.slug}` : "";
  return `${project.name} id=${project.id}${slug}`;
}
