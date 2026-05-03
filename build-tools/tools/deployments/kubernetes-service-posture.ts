#!/usr/bin/env zx-wrapper
import { deploymentError } from "./contract-extract-shared.ts";

const SERVICE_KIND_VALUES = new Set(["web", "worker", ""]);
const INGRESS_MODE_VALUES = new Set(["public", "private", "none", ""]);

export function pushKubernetesServicePostureErrors(opts: {
  label: string;
  componentKind: string;
  providerTarget: Record<string, string>;
  errors: string[];
}) {
  if (opts.componentKind !== "service") return;
  const serviceKind = opts.providerTarget.service_kind || "";
  const ingressMode = opts.providerTarget.ingress_mode || "";
  const healthPath = opts.providerTarget.health_path || "";
  if (!SERVICE_KIND_VALUES.has(serviceKind)) {
    opts.errors.push(deploymentError(opts.label, `unsupported service_kind "${serviceKind}"`));
  }
  if (!INGRESS_MODE_VALUES.has(ingressMode)) {
    opts.errors.push(deploymentError(opts.label, `unsupported ingress_mode "${ingressMode}"`));
  }
  if (serviceKind === "web") {
    if (ingressMode !== "public") {
      opts.errors.push(
        deploymentError(opts.label, "web service deployments must declare public ingress"),
      );
    }
    if (!healthPath) {
      opts.errors.push(
        deploymentError(opts.label, "web service deployments must declare health_path"),
      );
    }
  }
  if (serviceKind === "worker" && ingressMode === "public") {
    opts.errors.push(
      deploymentError(opts.label, "worker service deployments must not declare public ingress"),
    );
  }
}
