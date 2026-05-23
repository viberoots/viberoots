import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { canonicalInfisicalApiUrl } from "./infisical-iac-bootstrap-config";
import type { InfisicalApi } from "./infisical-iac-bootstrap-api";
import { ensureProjectIdentityMembership } from "./infisical-iac-bootstrap-identity";
import {
  resolveOpenTofuAdoption,
  type ExistingInfisicalResources,
} from "./infisical-iac-bootstrap-tofu-adoption";
import { errorMessage } from "./infisical-iac-bootstrap-redaction";
import type {
  BootstrapArgs,
  BootstrapCredential,
  CommandRunner,
  DeploymentRuntimeMetadata,
  Identity,
  TofuDeploymentRuntimeMetadata,
} from "./infisical-iac-bootstrap-types";

export async function planFilePath(args: BootstrapArgs) {
  if (args.tofuPlanFile) return path.resolve(args.tofuPlanFile);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-iac-bootstrap-plan-"));
  return path.join(dir, "pleomino-infisical.tfplan");
}

export async function runOpenTofu(opts: {
  args: BootstrapArgs & { organizationId: string };
  credential: BootstrapCredential;
  reviewedMetadata: Required<DeploymentRuntimeMetadata>;
  runner: CommandRunner;
  api?: InfisicalApi;
  bootstrapIdentity?: Identity;
  confirmApply?: (savedPlan: string) => Promise<boolean>;
}) {
  const tofuDir = path.resolve(opts.args.tofuDir);
  const savedPlan = await planFilePath(opts.args);
  await fs.mkdir(path.dirname(savedPlan), { recursive: true });
  const initEnv = tofuEnv(opts.args, opts.credential, opts.reviewedMetadata);
  runTofuStage("init", {
    args: ["init"],
    tofuDir,
    env: initEnv,
    runner: opts.runner,
    secrets: [opts.credential.clientSecret],
  });
  const adoption = await resolveOpenTofuAdoption({
    api: opts.api,
    args: opts.args,
    reviewedMetadata: opts.reviewedMetadata,
    tofuDir,
    runner: opts.runner,
  });
  if (adoption.projectId && opts.api && opts.bootstrapIdentity) {
    await ensureProjectIdentityMembership(opts.api, adoption.projectId, opts.bootstrapIdentity);
  }
  const env = tofuEnv(opts.args, opts.credential, opts.reviewedMetadata, adoption);
  runTofuStage("plan", {
    args: ["plan", `-out=${savedPlan}`],
    tofuDir,
    savedPlan,
    env,
    runner: opts.runner,
    secrets: [opts.credential.clientSecret],
  });
  printPlanSummary(tofuDir, savedPlan, opts.args.noTofuApply);
  if (opts.args.noTofuApply) return { savedPlan, adoption };
  const confirmed =
    opts.args.yes || (await (opts.confirmApply ?? promptApplyConfirmation)(savedPlan));
  if (!confirmed) throw new Error(`OpenTofu apply cancelled; saved plan remains at ${savedPlan}`);
  runTofuStage("apply", {
    args: ["apply", savedPlan],
    tofuDir,
    savedPlan,
    env,
    runner: opts.runner,
    secrets: [opts.credential.clientSecret],
  });
  return { savedPlan, adoption };
}

function runTofuStage(
  stage: "init" | "plan" | "apply",
  opts: {
    args: string[];
    tofuDir: string;
    savedPlan?: string;
    env: NodeJS.ProcessEnv;
    runner: CommandRunner;
    secrets?: Array<string | undefined>;
  },
) {
  try {
    return opts.runner({ command: "tofu", args: opts.args, cwd: opts.tofuDir, env: opts.env });
  } catch (error) {
    throw new Error(
      buildTofuFailureMessage({
        stage,
        tofuDir: opts.tofuDir,
        savedPlan: opts.savedPlan,
        retryArgs: opts.args,
        cause: errorMessage(error, opts.secrets),
      }),
    );
  }
}

export function buildTofuFailureMessage(opts: {
  stage: "init" | "plan" | "apply";
  tofuDir: string;
  savedPlan?: string;
  retryArgs: string[];
  cause: string;
}) {
  return [
    `OpenTofu ${opts.stage} failed.`,
    `Working directory: ${opts.tofuDir}`,
    ...(opts.savedPlan ? [`Saved plan: ${opts.savedPlan}`] : []),
    `Retry: cd ${quoteShell(opts.tofuDir)} && tofu ${opts.retryArgs.map(quoteShell).join(" ")}`,
    opts.cause ? `Cause: ${opts.cause}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function readDeploymentRuntimeMetadata(args: BootstrapArgs, runner: CommandRunner) {
  const stdout = runner({
    command: "tofu",
    args: ["output", "-json", "deployment_runtime_metadata"],
    cwd: path.resolve(args.tofuDir),
    capture: true,
  });
  return normalizeDeploymentRuntimeMetadata(JSON.parse(stdout || "{}"));
}

export function normalizeDeploymentRuntimeMetadata(raw: unknown): DeploymentRuntimeMetadata {
  const byStage = raw as TofuDeploymentRuntimeMetadata;
  const entries = Object.entries(byStage).filter(([, value]) => value && typeof value === "object");
  const projectId = entries.find(([, value]) => value.project_id)?.[1].project_id;
  const first = entries[0]?.[1];
  return {
    siteUrl: canonicalInfisicalApiUrl(first?.site_url),
    projectName: first?.project_name,
    projectId,
    projectSlug: first?.project_slug,
    secretPath: first?.secret_path,
    cloudflareSecretName: first?.cloudflare_secret_name,
    environments: Object.fromEntries(
      entries.map(([stage, value]) => [stage, { slug: value.environment ?? stage }]),
    ),
    deploymentCredentials: entries.map(([stage, value]) => ({
      stage,
      identityId: value.machine_identity_id ?? "",
      identityName: value.machine_identity_name ?? "",
      clientIdRef: `secret://deployments/pleomino/${stage}/infisical-client-id`,
      clientSecretRef: `secret://deployments/pleomino/${stage}/infisical-client-secret`,
      clientIdFileName: value.client_id_file_name,
      clientSecretFileName: value.client_secret_file_name,
    })),
  };
}

async function promptApplyConfirmation(savedPlan: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `OpenTofu plan saved at ${savedPlan}; rerun with --yes or use an interactive terminal to apply`,
    );
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`Apply saved OpenTofu plan ${savedPlan}? [y/N] `);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

function printPlanSummary(tofuDir: string, savedPlan: string, previewOnly: boolean) {
  console.error(buildPlanSummaryLines(tofuDir, savedPlan, previewOnly).join("\n"));
}

export function buildPlanSummaryLines(tofuDir: string, savedPlan: string, previewOnly: boolean) {
  return [
    "OpenTofu plan summary:",
    `- directory: ${tofuDir}`,
    `- saved plan: ${savedPlan}`,
    `- apply: ${previewOnly ? "disabled by --no-tofu-apply" : "pending confirmation"}`,
    "- secrets: supplied through process environment only",
  ];
}

function tofuEnv(
  args: BootstrapArgs & { organizationId: string },
  credential: BootstrapCredential,
  reviewed: Required<DeploymentRuntimeMetadata>,
  existing: ExistingInfisicalResources = {},
): NodeJS.ProcessEnv {
  const stages = Object.keys(reviewed.environments);
  return {
    INFISICAL_HOST: args.apiUrl,
    INFISICAL_UNIVERSAL_AUTH_CLIENT_ID: credential.clientId,
    INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET: credential.clientSecret,
    TF_VAR_infisical_host: args.apiUrl,
    TF_VAR_organization_id: args.organizationId,
    TF_VAR_project_name: reviewed.projectName,
    TF_VAR_project_slug: reviewed.projectSlug,
    TF_VAR_existing_project_id: existing.projectId ?? "",
    TF_VAR_existing_environment_slugs: JSON.stringify(existing.environmentSlugs ?? []),
    TF_VAR_environments: JSON.stringify(stages.map((stage) => reviewed.environments[stage].slug)),
    TF_VAR_secret_path: reviewed.secretPath,
    TF_VAR_cloudflare_secret_name: reviewed.cloudflareSecretName,
    TF_VAR_machine_identity_names: JSON.stringify(
      Object.fromEntries(
        reviewed.deploymentCredentials.map((item) => [item.stage, item.identityName]),
      ),
    ),
    TF_VAR_control_plane_credential_file_names: JSON.stringify(
      Object.fromEntries(
        reviewed.deploymentCredentials.map((item) => [
          item.stage,
          {
            client_id_file: item.clientIdFileName,
            client_secret_file: item.clientSecretFileName,
          },
        ]),
      ),
    ),
  };
}

function quoteShell(value: string) {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
