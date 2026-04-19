#!/usr/bin/env zx-wrapper

export type VaultKvV2ContractPath = {
  mount: string;
  secretPath: string;
  dataPath: string;
  metadataPath: string;
};

export function requireVaultContractPath(contractId: string): VaultKvV2ContractPath {
  const prefix = "secret://";
  if (!contractId.startsWith(prefix)) {
    throw new Error(`unsupported Vault secret contract id: ${contractId}`);
  }
  const secretPath = contractId.slice(prefix.length).trim().replace(/^\/+/, "");
  if (!secretPath) throw new Error(`invalid Vault secret contract id: ${contractId}`);
  return {
    mount: "secret",
    secretPath,
    dataPath: `secret/data/${secretPath}`,
    metadataPath: `secret/metadata/${secretPath}`,
  };
}

export function vaultApiPath(contractId: string, kind: "data" | "metadata"): string {
  const path = requireVaultContractPath(contractId);
  return `/v1/${path.mount}/${kind}/${path.secretPath}`;
}
