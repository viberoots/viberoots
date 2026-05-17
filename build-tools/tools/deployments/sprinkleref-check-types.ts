#!/usr/bin/env zx-wrapper
export type SprinkleRefScheme = "secret" | "config" | "runtime";
export type SprinkleRefStatus =
  | "present"
  | "declared"
  | "missing"
  | "unmapped"
  | "invalid"
  | "unchecked";
export type SprinkleRefScope = "repo" | "direct" | "dependency";
export type SprinkleRefDepsMode = "none" | "direct" | "transitive";

export type SprinkleRefLocation = {
  file: string;
  line: number;
};

export type SprinkleRefCheckEntry = {
  ref: string;
  scheme: SprinkleRefScheme;
  sensitive: boolean;
  status: SprinkleRefStatus;
  scope: SprinkleRefScope;
  locations: string[];
  requiredBy: string[];
  category?: string;
  backend?: string;
  source?: string;
  reason?: string;
};

export type SprinkleRefCheckReport = {
  target?: string;
  deps?: SprinkleRefDepsMode;
  scannedFiles: number;
  refs: SprinkleRefCheckEntry[];
  summary: Record<string, number>;
};
