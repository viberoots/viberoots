#!/usr/bin/env zx-wrapper
import { ensureCloudflarePagesCustomDomain } from "./cloudflare-pages-custom-domain.ts";
import { ensureCloudflarePagesProject } from "./cloudflare-pages-project.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";

export async function provisionCloudflarePagesTarget(opts: {
  deployment: CloudflarePagesDeployment;
  apiToken?: string;
}) {
  await ensureCloudflarePagesProject(opts);
  return await ensureCloudflarePagesCustomDomain(opts);
}
