#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeploymentComponent } from "./contract";
import type { NixosSharedHostPublishedSmokeInput } from "./nixos-shared-host-publish-runtime";
import { smokeNixosSharedHostSsrWebapp } from "./nixos-shared-host-ssr-smoke";
import { smokeNixosSharedHostStaticWebapp } from "./nixos-shared-host-static-smoke";

export async function smokeNixosSharedHostComponent(opts: {
  component: NixosSharedHostDeploymentComponent;
  smokeInput: NixosSharedHostPublishedSmokeInput;
  connectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}) {
  return opts.smokeInput.kind === "ssr-webapp"
    ? await smokeNixosSharedHostSsrWebapp({
        hostname: opts.component.providerTarget.hostname || "",
        healthPath: opts.component.runtime.healthPath,
        connectOverride: opts.connectOverride,
      })
    : await smokeNixosSharedHostStaticWebapp({
        hostname: opts.component.providerTarget.hostname || "",
        indexPath: opts.smokeInput.indexPath,
        healthPath: opts.component.runtime.healthPath,
        connectOverride: opts.connectOverride,
      });
}
