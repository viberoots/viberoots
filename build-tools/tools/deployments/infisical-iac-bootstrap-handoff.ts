import type {
  BootstrapArgs,
  DeploymentRuntimeMetadata,
  Identity,
} from "./infisical-iac-bootstrap-types";
import type { CredentialSinkSelection } from "./infisical-iac-bootstrap-sink";
import { repoBootstrapCredentialRefs } from "./infisical-iac-bootstrap-identity";

export function buildCredentialHandoffReport(opts: {
  args: BootstrapArgs;
  sinkSelection: CredentialSinkSelection;
  sinkDescription: string;
  bootstrapIdentity: Identity;
  metadata: DeploymentRuntimeMetadata;
}) {
  const bootstrapRefs = repoBootstrapCredentialRefs(
    opts.bootstrapIdentity,
    opts.args.bootstrapCredentialScope,
  );
  const targetCategory = opts.sinkSelection.category || opts.args.sprinkleCategory || "bootstrap";
  return {
    schemaVersion: "infisical-iac-bootstrap-handoff@1",
    credentialSink: opts.sinkSelection.kind,
    credentialSinkBackend: opts.sinkSelection.backend,
    sinkDescription: opts.sinkDescription,
    sprinkleCategory: targetCategory,
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
      targetCategory,
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
