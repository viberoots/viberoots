#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { NixosSharedHostDeployment } from "../../deployments/contract.ts";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime.ts";
import { startStaticWebappHttpsServer } from "./static-webapp.https-server.ts";

export async function startNixosSharedHostPublicServer(opts: {
  deployment: NixosSharedHostDeployment;
  hostRoot?: string;
  fixedRoot?: string;
  tlsRoot?: string;
}): Promise<{ port: number; close: () => Promise<void> }> {
  return await startStaticWebappHttpsServer({
    hostname: opts.deployment.providerTarget.hostname,
    root: () =>
      opts.fixedRoot ||
      path.join(
        nixosSharedHostContainerRoot(
          opts.hostRoot || "",
          opts.deployment.providerTarget.containerName,
        ),
        "srv/static-app/live",
      ),
    tlsRoot: opts.tlsRoot || opts.hostRoot || opts.fixedRoot,
  });
}
