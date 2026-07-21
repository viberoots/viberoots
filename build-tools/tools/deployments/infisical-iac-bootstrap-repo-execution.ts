import * as path from "node:path";
import { runDeploymentBootstrapFanOut } from "./infisical-iac-bootstrap-deployments";
import type {
  DeploymentBootstrapExecutionResult,
  DeploymentBootstrapFanOutResult,
} from "./infisical-iac-bootstrap-deployments";
import { applyFanOutMetadataHandoff } from "./infisical-iac-bootstrap-metadata-gate";
import { materializeRepoBackendProfiles } from "./infisical-iac-bootstrap-profiles";
import { ensureRepoResolverConfig } from "./infisical-iac-bootstrap-resolver";
import type { BootstrapArgs, Identity } from "./infisical-iac-bootstrap-types";
import type { InfisicalApi } from "./infisical-iac-bootstrap-api";
import type { SharedInfisicalSession } from "./infisical-iac-bootstrap-repo-credential";
import { readSprinkleRefConfig } from "./sprinkleref-config";
import { DEFAULT_SPRINKLEREF_CONFIG_PATH } from "./sprinkleref-config-select";

type ResolverResult = Awaited<ReturnType<typeof ensureRepoResolverConfig>>;
type FanOutIo = {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  question?: (prompt: string) => Promise<string>;
};

export async function runFanOutWithHandoff(
  args: BootstrapArgs,
  credential: SharedInfisicalSession | undefined,
  context: { workspaceRoot: string; graphPath: string },
  execute: (
    args: BootstrapArgs,
    context: {
      infisicalSession?: SharedInfisicalSession;
      workspaceRoot?: string;
      configPath?: string;
    },
  ) => Promise<DeploymentBootstrapExecutionResult | void>,
  io?: FanOutIo,
): Promise<DeploymentBootstrapFanOutResult> {
  const run = () =>
    runDeploymentBootstrapFanOut({
      args,
      workspaceRoot: context.workspaceRoot,
      graphPath: context.graphPath,
      io,
      execute: async (deploymentArgs) =>
        execute(deploymentArgs, {
          ...(credential ? { infisicalSession: credential } : {}),
          workspaceRoot: context.workspaceRoot,
          configPath: path.join(context.workspaceRoot, DEFAULT_SPRINKLEREF_CONFIG_PATH),
        }),
    });
  const fanOut = await run();
  if ((await applyFanOutMetadataHandoff(args, fanOut)).status === "applied") return await run();
  return fanOut;
}

export async function materializeRepoProfiles(
  args: BootstrapArgs,
  resolver: ResolverResult,
  credential?: { api: InfisicalApi; organizationId: string; identity: Identity },
) {
  if (!(await hasRequiredInfisicalProfile(resolver))) {
    return await materializeRepoBackendProfiles({
      args,
      configPath: resolver.configPath,
      workspaceRoot: resolver.workspaceRoot,
      requiredProfiles: resolver.profiles,
    });
  }
  if (!credential) throw new Error("Infisical bootstrap credential was not prepared");
  return await materializeRepoBackendProfiles({
    args,
    api: credential.api,
    organizationId: credential.organizationId,
    identity: credential.identity,
    configPath: resolver.configPath,
    workspaceRoot: resolver.workspaceRoot,
    requiredProfiles: resolver.profiles,
  });
}

export async function hasRequiredInfisicalProfile(resolver: ResolverResult) {
  const config = await readSprinkleRefConfig(resolver.configPath, resolver.workspaceRoot);
  return resolver.profiles.some((profile) => {
    const backend = config.profiles[profile];
    return profile.startsWith("infisical-") || backend?.backend === "infisical";
  });
}
