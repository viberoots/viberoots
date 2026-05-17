import * as readline from "node:readline/promises";
import type { InfisicalApi } from "./infisical-iac-bootstrap-api";
import type { BootstrapArgs, Organization } from "./infisical-iac-bootstrap-types";

export async function listOrganizations(api: InfisicalApi): Promise<Organization[]> {
  const result = await api.request<{ organizations: Organization[] }>(
    "GET",
    "/api/v1/organization",
  );
  return result?.organizations ?? [];
}

export function organizationListReason(orgs: Organization[], allowSingle = false) {
  if (orgs.length === 0) return "No accessible Infisical organizations found for this token.";
  const prefix =
    orgs.length === 1 && allowSingle
      ? "Accessible Infisical organization requires an explicit selection:"
      : "Multiple accessible Infisical organizations require an explicit selection:";
  return [prefix, ...formatOrganizationList(orgs)].join("\n");
}

export function formatOrganizationList(orgs: Organization[]) {
  return orgs.map((org, index) => `${index + 1}. ${org.name} (${org.id})`);
}

export async function resolveOrganizationId(
  api: InfisicalApi,
  args: BootstrapArgs,
  io = {
    stdin: process.stdin,
    stdout: process.stdout,
    question: undefined as QuestionFn | undefined,
  },
) {
  if (args.organizationId) return args.organizationId;
  const orgs = await listOrganizations(api);
  if (args.orgName) return orgIdByExactName(orgs, args.orgName);
  if (orgs.length === 0) throw new Error(organizationListReason(orgs));
  if (args.yes && orgs.length === 1) return orgs[0].id;
  return await selectOrganizationFromList(orgs, io);
}

export function orgIdByExactName(orgs: Organization[], name: string) {
  const matches = orgs.filter((org) => org.name === name);
  if (matches.length === 1) return matches[0].id;
  if (matches.length === 0)
    throw new Error(`no accessible Infisical organization named ${JSON.stringify(name)}`);
  throw new Error(`multiple accessible Infisical organizations named ${JSON.stringify(name)}`);
}

type QuestionFn = (prompt: string) => Promise<string>;

export async function selectOrganizationFromList(
  orgs: Organization[],
  io: { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream; question?: QuestionFn },
) {
  console.log(["Accessible Infisical organizations:", ...formatOrganizationList(orgs)].join("\n"));
  if (!io.stdin.isTTY || !io.stdout.isTTY) {
    throw new Error(
      `${organizationListReason(orgs, true)}\nTerminal input is not available; rerun with --org-name or --organization-id.`,
    );
  }
  if (io.question)
    return selectedOrganizationId(orgs, await io.question("Select organization number: "));
  const rl = readline.createInterface({ input: io.stdin, output: io.stdout });
  try {
    return selectedOrganizationId(orgs, await rl.question("Select organization number: "));
  } finally {
    rl.close();
  }
}

function selectedOrganizationId(orgs: Organization[], answer: string) {
  const selected = Number(answer.trim());
  if (!Number.isInteger(selected) || selected < 1 || selected > orgs.length) {
    throw new Error(`invalid organization selection: ${JSON.stringify(answer.trim())}`);
  }
  return orgs[selected - 1].id;
}
