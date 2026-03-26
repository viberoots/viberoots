#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

export async function createNixosSharedHostInstallFixture(opts: {
  root: string;
  topology: "flake" | "plain";
  withExtraImports?: boolean;
  withNginxConfig?: boolean;
}): Promise<{ hostRoot: string; configRoot: string; configEntryPath: string }> {
  const hostRoot = path.join(opts.root, "host");
  const configRoot = path.join(hostRoot, "etc", "nixos");
  const configEntryPath =
    opts.topology === "flake"
      ? path.join(configRoot, "flake.nix")
      : path.join(configRoot, "configuration.nix");
  await fsp.mkdir(path.join(hostRoot, "etc", "nix"), { recursive: true });
  await fsp.writeFile(path.join(hostRoot, "etc", "os-release"), "ID=nixos\n", "utf8");
  await fsp.writeFile(
    path.join(hostRoot, "etc", "nix", "nix.conf"),
    "experimental-features = nix-command flakes\n",
    "utf8",
  );
  await fsp.mkdir(configRoot, { recursive: true });
  if (opts.withExtraImports) {
    await fsp.writeFile(path.join(configRoot, "existing.nix"), "{ ... }: { }\n", "utf8");
  }
  if (opts.withNginxConfig) {
    await fsp.writeFile(
      path.join(configRoot, "nginx.nix"),
      "{ ... }: { services.nginx.enable = true; }\n",
      "utf8",
    );
  }
  const configText =
    opts.topology === "flake"
      ? [
          "{",
          "  outputs = { nixpkgs, ... }: {",
          "    nixosConfigurations.mini = nixpkgs.lib.nixosSystem {",
          '      system = "x86_64-linux";',
          "      modules = [",
          "        ./hardware-configuration.nix",
          ...(opts.withExtraImports ? ["        ./existing.nix"] : []),
          ...(opts.withNginxConfig ? ["        ./nginx.nix"] : []),
          "      ];",
          "    };",
          "  };",
          "}",
          "",
        ].join("\n")
      : [
          "{ ... }:",
          "{",
          "  imports = [",
          "    ./hardware-configuration.nix",
          ...(opts.withExtraImports ? ["    ./existing.nix"] : []),
          ...(opts.withNginxConfig ? ["    ./nginx.nix"] : []),
          "  ];",
          "}",
          "",
        ].join("\n");
  await fsp.writeFile(configEntryPath, configText, "utf8");
  await fsp.writeFile(
    path.join(configRoot, "hardware-configuration.nix"),
    "{ ... }: { }\n",
    "utf8",
  );
  return { hostRoot, configRoot, configEntryPath };
}
