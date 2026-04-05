#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract.ts";
import {
  resolveCrossDeploymentPromotionSelection,
  type CrossDeploymentPromotionSelection,
} from "./deployment-promotion.ts";

export async function resolveCloudflarePagesPromotionSelection(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  recordsRoot: string;
  sourceRunId: string;
}): Promise<CrossDeploymentPromotionSelection<CloudflarePagesDeployment>> {
  return await resolveCrossDeploymentPromotionSelection(opts);
}
