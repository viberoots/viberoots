export type Capabilities = Record<string, boolean>;

import type { PatchInvalidationStrategy } from "../../lib/lang-contracts";

export type LangEntry = {
  id: string;
  displayName?: string;
  requiredPaths?: string[];
  optionalPaths?: string[];
  kinds?: string[];
  capabilities?: Capabilities;
  templatesDir?: string;
};

export type Manifest = { enabled?: string[]; languages?: LangEntry[] } | LangEntry[];

export type DiagnoseOutput = {
  enabled: string[];
  disabled: Array<{ id: string; missingPaths: string[] }>;
  adapters: string[];
  plannerPlugins: string[];
  stages: string[];
  patchInvalidation: Record<string, PatchInvalidationStrategy | null>;
};
