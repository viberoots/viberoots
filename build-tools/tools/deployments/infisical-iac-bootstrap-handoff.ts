import type {
  BootstrapArgs,
  DeploymentRuntimeMetadata,
  Identity,
} from "./infisical-iac-bootstrap-types";
import type { CredentialSinkSelection } from "./infisical-iac-bootstrap-sink";
import { bootstrapCredentialRefs } from "./infisical-iac-bootstrap-identity";

export function buildCredentialHandoffReport(opts: {
  args: BootstrapArgs;
  sinkSelection: CredentialSinkSelection;
  sinkDescription: string;
  bootstrapIdentity: Identity;
  metadata: DeploymentRuntimeMetadata;
}) {
  const bootstrapRefs = bootstrapCredentialRefs(opts.bootstrapIdentity);
  return {
    schemaVersion: "infisical-iac-bootstrap-handoff@1",
    credentialSink: opts.sinkSelection.kind,
    credentialSinkBackend: opts.sinkSelection.backend,
    sinkDescription: opts.sinkDescription,
    sprinkleCategory: opts.args.sprinkleCategory,
    bootstrapCredentialRefs: bootstrapRefs,
    deploymentCredentials: (opts.metadata.deploymentCredentials ?? []).map((item) => ({
      stage: item.stage,
      status: "managed",
      lifecycleOwner: "infisical-iac-bootstrap",
      identityId: item.identityId,
      identityName: item.identityName,
      clientIdRef: item.clientIdRef,
      clientSecretRef: item.clientSecretRef,
      clientIdFileName: item.clientIdFileName,
      clientSecretFileName: item.clientSecretFileName,
    })),
    resolverHandoff: {
      targetCategory: opts.args.sprinkleCategory,
      refs: [
        bootstrapRefs.clientIdRef,
        bootstrapRefs.clientSecretRef,
        ...(opts.metadata.deploymentCredentials ?? []).flatMap((item) => [
          item.clientIdRef,
          item.clientSecretRef,
        ]),
      ],
      nextSteps: ["populate application secrets with sprinkleref add/update"],
    },
  };
}
