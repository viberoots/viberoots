export type NixCacheHealthDeps = {
  readEffectiveConfig?: () => Promise<string>;
  readCacheRoleProvenance?: () => { required: string[]; optional: string[] } | undefined;
  probeUrl?: (url: string, timeoutMs: number) => Promise<boolean>;
  resolveCurlBin?: (env: NodeJS.ProcessEnv) => string;
  log?: (line: string) => void;
};

export type CacheHealthResult = {
  authority: "reviewed" | "off";
  changed: boolean;
  kept: string[];
  removed: string[];
  nixConfig: string;
  requiredSubstituters: string[];
  optionalSubstituters: string[];
};

export function offCacheHealthResult(nixConfig: string): CacheHealthResult {
  return {
    authority: "off",
    changed: false,
    kept: [],
    removed: [],
    nixConfig,
    requiredSubstituters: [],
    optionalSubstituters: [],
  };
}
