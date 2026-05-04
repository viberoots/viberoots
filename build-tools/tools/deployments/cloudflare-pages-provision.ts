#!/usr/bin/env zx-wrapper
import { ensureCloudflarePagesCustomDomain } from "./cloudflare-pages-custom-domain";
import { ensureCloudflarePagesProject } from "./cloudflare-pages-project";
import type { CloudflarePagesDeployment } from "./contract";

export async function provisionCloudflarePagesTarget(opts: {
  deployment: CloudflarePagesDeployment;
  apiToken?: string;
}) {
  await ensureCloudflarePagesProject(opts);
  return await ensureCloudflarePagesCustomDomain(opts);
}
