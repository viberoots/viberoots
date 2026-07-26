import { enforceNodeImplementationRouteChecks } from "./nix-gaps-inventory-node-routes";
import {
  enforceRustImplementationRouteChecks,
  rustDefsBzlPath,
} from "./nix-gaps-inventory-rust-routes";

export async function enforceImplementationRouteChecks(opts: {
  source: string;
  starlarkByModule: Record<string, string[]>;
  nixRouteDetailsByMacro: Record<string, string>;
  hasNodeImplementationFiles: boolean;
}): Promise<void> {
  await enforceNodeImplementationRouteChecks({
    hasNodeImplementationFiles: opts.hasNodeImplementationFiles,
    nixRouteDetailsByMacro: opts.nixRouteDetailsByMacro,
  });
  const rustPublicMacros = opts.starlarkByModule[rustDefsBzlPath] || [];
  if (rustPublicMacros.length > 0) {
    await enforceRustImplementationRouteChecks(
      opts.source,
      rustPublicMacros,
      opts.nixRouteDetailsByMacro,
    );
  }
}
