import type { MaterializedPathInput } from "../../../../dev/filtered-flake-viberoots-input";

export const LOCAL_FIXTURE_SERVICE_ENV = "VBR_DEPLOY_LOCAL_FIXTURE_SERVICE";

export type RunInTempOptions = {
  git?: boolean;
  reconcileDependencyInputs?: boolean;
  workspace?: "seeded" | "scratch";
};

export type RunInTempCallback<T> = (tmp: string, $: any) => Promise<T>;

export type TempAllocation = {
  home: string;
  removeHome: boolean;
  realHome: string;
  tmp: string;
};

export type SeededTempSetup = TempAllocation & {
  $setup: any;
  activeViberootsRoot: string;
  buck2ShimDir: string;
  goModCacheRoot: string;
  tempNestedIso: string;
  tempSetupEnv: Record<string, string>;
  viberootsInput: MaterializedPathInput;
  viberootsSourceRoot: string;
  xdgCacheHome: string;
};
