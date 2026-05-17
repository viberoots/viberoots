import type {
  BootstrapArgs,
  DeploymentRuntimeMetadata,
  Identity,
} from "./infisical-iac-bootstrap-types";

export function buildCredentialHandoffReport(opts: {
  args: BootstrapArgs;
  sinkDescription: string;
  bootstrapIdentity: Identity;
  metadata: DeploymentRuntimeMetadata;
}) {
  return {
    schemaVersion: "infisical-iac-bootstrap-handoff@1",
    credentialSink: opts.args.credentialSink === "auto" ? "local-file" : opts.args.credentialSink,
    sinkDescription: opts.sinkDescription,
    sprinkleCategory: opts.args.sprinkleCategory,
    bootstrapCredentialRef: `secret://deployments/pleomino/bootstrap/${opts.bootstrapIdentity.name}/client-secret`,
    deploymentCredentials: (opts.metadata.deploymentCredentials ?? []).map((item) => ({
      stage: item.stage,
      status: "handoff-only",
      lifecycleOwner: "deployment credential lifecycle migration",
      identityId: item.identityId,
      identityName: item.identityName,
      clientIdRef: item.clientIdRef,
      clientSecretRef: item.clientSecretRef,
      clientIdFileName: item.clientIdFileName,
      clientSecretFileName: item.clientSecretFileName,
    })),
    resolverHandoff: {
      targetCategory: "bootstrap",
      refs: [
        `secret://deployments/pleomino/bootstrap/${opts.bootstrapIdentity.name}/client-secret`,
        ...(opts.metadata.deploymentCredentials ?? []).flatMap((item) => [
          item.clientIdRef,
          item.clientSecretRef,
        ]),
      ],
      nextSteps: [
        "SprinkleRef resolver category support",
        "deployment credential lifecycle migration",
      ],
    },
  };
}
