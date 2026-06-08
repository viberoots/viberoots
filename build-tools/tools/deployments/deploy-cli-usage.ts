#!/usr/bin/env zx-wrapper
export const DEPLOY_CLI_USAGE = `Usage:
  deploy --deployment <label> [options]

Control-plane selection:
  Deployment contexts with controlPlane select a named controlPlanes profile by default.
  controlPlanes.<name>.serviceClient.controlPlaneUrl is shared config; controlPlaneTokenRef must
    be a secret:// or runtime:// credential ref.
  --control-plane-url <url> is an explicit service URL for commands without deployment context.
  VBR_DEPLOY_CONTROL_PLANE_URL is an ambient fallback only for commands without deployment context.
  --remote <name> requires a matching controlPlanes.<name> profile.
  --allow-control-plane-override permits a mismatching explicit --control-plane-url for a
    context-selected deployment and records that source as an explicit override.
  VBR_DEPLOY_CONTROL_PLANE_URL never overrides a context-selected deployment.
`;
