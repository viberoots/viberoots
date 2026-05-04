#!/usr/bin/env zx-wrapper
import type { DeploymentProviderCapability } from "./types";

const DEPLOY_CODE_SNIPPET = /`(deploy [^`]*)`/g;
const ALLOWED_NON_SELECTOR_COMMAND = /^deploy --(?:help|list)\b/;

function appendPath(base: string, segment: string): string {
  return base ? `${base}.${segment}` : segment;
}

function validateDeployCommand(provider: string, path: string, command: string): string[] {
  if (ALLOWED_NON_SELECTOR_COMMAND.test(command)) {
    return [];
  }
  if (command.includes("--deployment ")) {
    return [];
  }
  return [
    `${provider}: ${path} deploy command must use the reviewed --deployment <label> selector: \`${command}\``,
  ];
}

function validateDeployCommands(provider: string, path: string, text: string): string[] {
  const errors: string[] = [];
  for (const match of text.matchAll(DEPLOY_CODE_SNIPPET)) {
    errors.push(...validateDeployCommand(provider, path, match[1]));
  }
  return errors;
}

function validateValue(provider: string, path: string, value: unknown, errors: string[]): void {
  if (typeof value === "string") {
    errors.push(...validateDeployCommands(provider, path, value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateValue(provider, `${path}[${index}]`, entry, errors));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    validateValue(provider, appendPath(path, key), entry, errors);
  }
}

export function validateCapabilityFrontDoorContract(
  provider: string,
  capability: DeploymentProviderCapability,
): string[] {
  const errors: string[] = [];
  validateValue(provider, "capability", capability, errors);
  return errors;
}

export function assertDeployTextUsesReviewedSelector(label: string, text: string): void {
  const errors = validateDeployCommands(label, "text", text);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}
