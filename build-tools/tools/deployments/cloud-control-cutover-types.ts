export const CUTOVER_OPERATIONS = ["cutover", "rollback", "restore", "break-glass"] as const;

export type CutoverOperation = (typeof CUTOVER_OPERATIONS)[number];

export type CutoverEvidence = {
  schemaVersion?: string;
  hostProfile: string;
  region?: string;
  generatedAt: string;
  health?: Record<string, unknown>;
  imagePublication?: ControlPlaneImagePublicationEvidence;
  awsTopology?: Record<string, unknown>;
  latestNonProductionDeployment?: Record<string, unknown>;
  providerCapabilities?: Record<string, Record<string, unknown>>;
  standby?: Record<string, unknown>;
  restore?: Record<string, unknown>;
  rollback?: Record<string, unknown>;
  breakGlass?: Record<string, unknown>;
  audit?: Record<string, unknown>;
};

export type CutoverValidationOptions = {
  expectedHostProfile: string;
  expectedImageBuildIdentity: string;
  expectedRegion?: string;
  operation: CutoverOperation;
  selectedCapabilities: string[];
  maxAgeMinutes: number;
};

export type CutoverValidationResult = {
  ok: boolean;
  errors: string[];
  checklist: string[];
};
import type { ControlPlaneImagePublicationEvidence } from "./control-plane-image-publication";
