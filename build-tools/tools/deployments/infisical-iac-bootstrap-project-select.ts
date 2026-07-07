import type { InfisicalRepoProject } from "./infisical-iac-bootstrap-profile-api";
import {
  hasControllingTerminal,
  promptTerminalLine,
  promptTerminalSelect,
} from "../lib/terminal-select";

export type InfisicalRepoProjectSelection =
  | { kind: "existing"; projectId: string }
  | { kind: "create"; projectName: string };

export type InfisicalRepoProjectSelector = (opts: {
  projects: InfisicalRepoProject[];
  defaultProjectName: string;
}) => Promise<InfisicalRepoProjectSelection>;

const CREATE_DEFAULT_PROJECT_VALUE = "__create_default_infisical_project__";

export async function selectInfisicalRepoProject(
  projects: InfisicalRepoProject[],
  defaultProjectName: string,
  selectProject?: InfisicalRepoProjectSelector,
) {
  if (selectProject) return await selectProject({ projects, defaultProjectName });
  const choices = [
    ...projects.map((project) => ({
      label: projectChoiceLabel(project),
      value: project.id,
      valueLabel: false,
    })),
    {
      label: `Create or use another project...`,
      value: CREATE_DEFAULT_PROJECT_VALUE,
      valueLabel: false,
    },
  ];
  const selected = await promptTerminalSelect(
    "Select Infisical project",
    choices,
    choices.length - 1,
    {
      cancelMessage: "Infisical project selection cancelled",
    },
  );
  if (selected !== CREATE_DEFAULT_PROJECT_VALUE) return { kind: "existing", projectId: selected };
  const projectName = await promptTerminalLine("Infisical project name", defaultProjectName);
  return { kind: "create", projectName: validateSelectedProjectName(projectName) };
}

export function shouldPromptForInfisicalProject(allowInteractiveSelection: boolean | undefined) {
  if (!allowInteractiveSelection) return false;
  return Boolean((process.stdin.isTTY && process.stderr.isTTY) || hasControllingTerminal());
}

function projectChoiceLabel(project: InfisicalRepoProject) {
  const slug = project.slug && project.slug !== project.name ? ` slug=${project.slug}` : "";
  return `${project.name}${slug}`;
}

function validateSelectedProjectName(projectName: string) {
  const trimmed = projectName.trim();
  if (!trimmed) throw new Error("Infisical project name must not be empty");
  if (/[\r\n\t]/.test(trimmed)) {
    throw new Error("Infisical project name must not contain control whitespace");
  }
  return trimmed;
}
