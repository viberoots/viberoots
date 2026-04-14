#!/usr/bin/env zx-wrapper
import type { DeploymentProviderCapability, ProviderCapabilityBullet } from "./types.ts";

function renderBullets(bullets: ProviderCapabilityBullet[], indent = 0): string[] {
  return bullets.flatMap((entry) => {
    const prefix = `${"  ".repeat(indent)}- `;
    const lines = [`${prefix}${entry.text}`];
    if (entry.children && entry.children.length > 0) {
      lines.push(...renderBullets(entry.children, indent + 1));
    }
    return lines;
  });
}

function renderSection(title: string, bullets: ProviderCapabilityBullet[]): string[] {
  return [`### ${title}`, "", ...renderBullets(bullets), ""];
}

function listBullet(label: string, values: string[]): ProviderCapabilityBullet {
  return { text: label, children: values.map((value) => ({ text: value })) };
}

function renderIdentity(capability: DeploymentProviderCapability): string[] {
  const bullets: ProviderCapabilityBullet[] = [
    { text: `\`provider\`: \`${capability.provider}\`` },
    listBullet("canonical target identity fields:", capability.canonicalTargetIdentity.fields),
    {
      text: "canonical lock-key shape:",
      children: capability.canonicalTargetIdentity.lockKeyShape,
    },
  ];
  if (capability.canonicalTargetIdentity.requiredReviewedProviderTargetFields) {
    bullets.push({
      text: "required reviewed provider-target fields:",
      children: capability.canonicalTargetIdentity.requiredReviewedProviderTargetFields,
    });
  }
  if (capability.canonicalTargetIdentity.requiredNormalizedDerivedFields) {
    bullets.push({
      text: "required normalized derived fields:",
      children: capability.canonicalTargetIdentity.requiredNormalizedDerivedFields,
    });
  }
  return renderSection("Identity", bullets);
}

function renderComponentSupport(capability: DeploymentProviderCapability): string[] {
  const bullets: ProviderCapabilityBullet[] = [
    listBullet(
      "supported component kinds:",
      capability.supportedComponentKinds.map((kind) => `\`${kind}\``),
    ),
    {
      text: "multi-component support:",
      children: capability.componentSupport.reviewedMultiComponentSupport,
    },
  ];
  if (capability.componentSupport.additionalUnsupportedShapes?.length) {
    bullets.push(
      listBullet(
        "additional unsupported shapes:",
        capability.componentSupport.additionalUnsupportedShapes,
      ),
    );
  }
  return renderSection("Component Support", bullets);
}

function renderRolloutSupport(capability: DeploymentProviderCapability): string[] {
  const bullets: ProviderCapabilityBullet[] = [
    listBullet("default rollout mode:", [`\`${capability.defaultRolloutMode}\``]),
    {
      text: "rollout-policy omission posture:",
      children: capability.rolloutPolicyOmissionInPolicy.reviewedPosture,
    },
    listBullet(
      "supported rollout modes:",
      capability.supportedRolloutModes.map((mode) => `\`${mode}\``),
    ),
  ];
  if (capability.rolloutSupport.unsupportedModes?.length) {
    bullets.push(
      listBullet(
        "unsupported rollout modes:",
        capability.rolloutSupport.unsupportedModes.map((mode) => `\`${mode}\``),
      ),
    );
  }
  if (capability.rolloutSupport.reviewedStagedRolloutPosture) {
    bullets.push({
      text: "reviewed staged-rollout posture:",
      children: capability.rolloutSupport.reviewedStagedRolloutPosture,
    });
  }
  if (capability.rolloutSupport.reviewedMultiComponentPosture) {
    bullets.push({
      text: "reviewed multi-component posture:",
      children: capability.rolloutSupport.reviewedMultiComponentPosture,
    });
  }
  return renderSection("Rollout Support", bullets);
}

function renderPreviewSupport(capability: DeploymentProviderCapability): string[] {
  const bullets: ProviderCapabilityBullet[] = [
    { text: "preview support:", children: capability.previewSupport.support },
  ];
  if (capability.previewSupport.isolationModel) {
    bullets.push({
      text: "preview isolation model:",
      children: capability.previewSupport.isolationModel,
    });
  }
  if (capability.previewSupport.cleanupDefault) {
    bullets.push({
      text: "preview cleanup default:",
      children: capability.previewSupport.cleanupDefault,
    });
  }
  if (capability.previewSupport.lockScopeDefault) {
    bullets.push({
      text: "preview lock-scope default:",
      children: capability.previewSupport.lockScopeDefault,
    });
  }
  if (capability.previewSupport.requiredGuarantees?.length) {
    bullets.push(listBullet("required guarantees:", capability.previewSupport.requiredGuarantees));
  }
  return renderSection("Preview Support", bullets);
}

function renderSmokeReleaseHealth(capability: DeploymentProviderCapability): string[] {
  const bullets: ProviderCapabilityBullet[] = [
    {
      text: "default smoke model:",
      children: capability.smokeReleaseHealth.defaultSmokeModel,
    },
  ];
  if (capability.smokeReleaseHealth.previewOverride) {
    bullets.push({
      text: "preview override:",
      children: capability.smokeReleaseHealth.previewOverride,
    });
  }
  return renderSection("Smoke / Release Health", bullets);
}

function renderPublisherContract(capability: DeploymentProviderCapability): string[] {
  const bullets: ProviderCapabilityBullet[] = [
    listBullet(
      capability.builtInPublisherContract.publisherTypes.length > 1
        ? "built-in publisher types:"
        : "built-in publisher type:",
      capability.builtInPublisherContract.publisherTypes.map((type) => `\`${type}\``),
    ),
  ];
  if (capability.builtInPublisherContract.exactPublishInput) {
    bullets.push({
      text: "exact publish input:",
      children: capability.builtInPublisherContract.exactPublishInput,
    });
  }
  if (capability.builtInPublisherContract.checkedInProviderConfig) {
    bullets.push({
      text: "checked-in provider config:",
      children: capability.builtInPublisherContract.checkedInProviderConfig,
    });
  }
  if (capability.builtInPublisherContract.accountSelection) {
    bullets.push({
      text: "account selection:",
      children: capability.builtInPublisherContract.accountSelection,
    });
  }
  if (capability.builtInPublisherContract.additionalFacts) {
    bullets.push(...capability.builtInPublisherContract.additionalFacts);
  }
  return renderSection("Built-In Publisher Contract", bullets);
}

function renderOptionalSection(
  title: string,
  bullets: ProviderCapabilityBullet[] | undefined,
): string[] {
  return bullets ? renderSection(title, bullets) : [];
}

export function renderProviderCapabilityEntry(capability: DeploymentProviderCapability): string {
  const lines = [
    `## Capability Entry: \`${capability.provider}\``,
    "",
    ...renderIdentity(capability),
    ...renderComponentSupport(capability),
    ...renderRolloutSupport(capability),
    ...renderPreviewSupport(capability),
    ...renderSmokeReleaseHealth(capability),
    ...renderPublisherContract(capability),
    ...renderSection("Retry / Idempotency", capability.retryIdempotency),
    ...renderOptionalSection("Replay Snapshot Baseline", capability.replaySnapshotBaseline),
    ...renderOptionalSection(
      "Immutable-Reuse Operator Flows",
      capability.immutableReuseOperatorFlows,
    ),
    ...renderOptionalSection("Promotion Compatibility", capability.promotionCompatibility),
    ...renderOptionalSection("Target Transition Support", capability.targetTransitionSupport),
    ...renderSection("Partial Publish Observability", capability.partialPublishObservability),
    ...renderSection("Provisioner Support", capability.provisionerSupport),
    ...renderSection("Built-In `release_actions` Support", [
      {
        text: "protected/shared built-in `release_actions`:",
        children: capability.releaseActions.reviewedSupport,
      },
    ]),
    ...renderSection("Protected/Shared Eligibility", capability.protectedSharedEligibility),
    ...(capability.additionalSections || []).flatMap((section) =>
      renderSection(section.title, section.bullets),
    ),
  ];
  return lines.join("\n").trim();
}

export function renderProviderCapabilityEntries(
  capabilities: DeploymentProviderCapability[],
): string {
  return capabilities.map(renderProviderCapabilityEntry).join("\n\n");
}
