import path from "node:path";

function keychainServiceName(workspaceRoot: string, suffix = ""): string {
  const name = `${path.basename(path.resolve(workspaceRoot))}${suffix}`.trim();
  if (!name) throw new Error("Keychain service name must not be empty");
  if (/[\r\n\t]/.test(name)) throw new Error("Keychain service name contains control whitespace");
  return name;
}

export function defaultBootstrapKeychainServiceName(workspaceRoot: string): string {
  return keychainServiceName(workspaceRoot, "-bootstrap");
}

export function defaultRepoKeychainServiceName(workspaceRoot: string): string {
  return keychainServiceName(workspaceRoot);
}
