import { applyMetadataHandoffPatch } from "./infisical-iac-bootstrap-metadata-handoff";
import { requireConsistentMetadataHandoffs } from "./infisical-iac-bootstrap-handoff-consistency";
import { askConfirmation, isAffirmativeConfirmation } from "./infisical-iac-bootstrap-preflight";
import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";
import type { DeploymentBootstrapFanOutResult } from "./infisical-iac-bootstrap-deployments";

export async function applyFanOutMetadataHandoff(
  args: BootstrapArgs,
  fanOut: DeploymentBootstrapFanOutResult,
) {
  const patch = requireConsistentMetadataHandoffs(fanOut.metadataHandoffs);
  if (!patch) return { status: "not_required" as const };
  if (!args.applyMetadataPatch) await requireInteractiveApproval(patch.unifiedDiff);
  await applyMetadataHandoffPatch(patch);
  return {
    status: "applied" as const,
    path: patch.path,
    targets: fanOut.metadataHandoffs.map((item) => item.target),
  };
}

async function requireInteractiveApproval(diff: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      [
        "First-bootstrap metadata handoff produced a reviewed metadata patch.",
        "Review the printed patch, then rerun with --apply-metadata-patch to apply it non-interactively.",
      ].join("\n"),
    );
  }
  console.error(diff);
  const answer = await askConfirmation("Apply reviewed Infisical metadata patch? [Y/n] ", {});
  if (!isAffirmativeConfirmation(answer)) throw new Error("metadata patch application cancelled");
}
