import * as fsp from "node:fs/promises";
import path from "node:path";
import { $ } from "zx";

export const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
export const reviewedCsp =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' ipc: http://ipc.localhost";

function nixStrings(values: string[]): string {
  return `[ ${values.map((value) => JSON.stringify(value)).join(" ")} ]`;
}

export function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    build: { frontendDist: "frontend-dist" },
    app: {
      withGlobalTauri: false,
      security: { csp: reviewedCsp, capabilities: ["default"] },
      windows: [{ label: "main" }],
    },
    bundle: {
      createUpdaterArtifacts: false,
      externalBin: [],
      icon: ["icons/icon.png"],
      resources: { "help.txt": "help/help.txt" },
    },
    ...overrides,
  };
}

export async function policyScript(
  root: string,
  policy: {
    appCommands?: string[];
    appWindows?: string[];
    capabilityFiles?: string[];
    permissionFiles?: string[];
  } = {},
): Promise<string> {
  const nixBin = process.env.VBR_NIX_BIN || process.env.NIX_BIN || "nix";
  const profileLinks = (
    await fsp.readdir(path.join(sourceRoot, ".direnv"), { withFileTypes: true })
  )
    .filter((entry) => entry.isSymbolicLink() && entry.name.startsWith("flake-profile-"))
    .map((entry) => path.join(sourceRoot, ".direnv", entry.name));
  if (profileLinks.length !== 1) {
    throw new Error(`expected one declared dev-shell profile, found ${profileLinks.length}`);
  }
  const profile = await fsp.realpath(profileLinks[0]);
  const profileData = JSON.parse(await fsp.readFile(profile, "utf8")) as {
    variables?: Record<string, { value?: string }>;
  };
  const jqRoots = [
    ...new Set(
      ["PATH", "HOST_PATH"]
        .flatMap((name) => (profileData.variables?.[name]?.value || "").split(":"))
        .filter((value) => /^\/nix\/store\/[a-z0-9]{32}-jq-[^/]+-bin\/bin$/.test(value))
        .map((value) => path.dirname(value)),
    ),
  ];
  if (jqRoots.length !== 1) {
    throw new Error(
      `expected one jq output in the declared dev-shell closure, found ${jqRoots.length}`,
    );
  }
  const jqRoot = jqRoots[0];
  const pythonRoot = path.dirname(
    path.dirname(await fsp.realpath(String((await $`command -v python3`).stdout).trim())),
  );
  if (!/^\/nix\/store\/[a-z0-9]{32}-/.test(pythonRoot)) {
    throw new Error(`expected Python from the declared Nix closure, got ${pythonRoot}`);
  }
  const template = path.join(sourceRoot, "build-tools/tools/nix/templates/rust-tauri.nix");
  const expression = `
    let
      lib = rec {
        optionals = condition: values: if condition then values else [];
        optionalString = condition: value: if condition then value else "";
        removeSuffix = suffix: value:
          if builtins.substring ((builtins.stringLength value) - (builtins.stringLength suffix))
            (builtins.stringLength suffix) value == suffix
          then builtins.substring 0 ((builtins.stringLength value) - (builtins.stringLength suffix)) value
          else value;
        concatMapStringsSep = separator: f: values: builtins.concatStringsSep separator (map f values);
        escapeShellArg = value: "'" + builtins.replaceStrings ["'"] ["'\\\\''"] (builtins.toString value) + "'";
        toJSON = builtins.toJSON;
        sort = builtins.sort;
        replaceStrings = builtins.replaceStrings;
      };
      pkgs = {
        cargo-tauri = "/nix/store/cargo-tauri";
        jq = ${JSON.stringify(jqRoot)};
        python3 = ${JSON.stringify(pythonRoot)};
        apple-sdk = "/nix/store/apple-sdk";
        stdenv.hostPlatform.system = "aarch64-darwin";
      };
      result = import (builtins.toPath ${JSON.stringify(template)}) {
        inherit pkgs lib;
        kind = "tauri"; targetName = "desktop";
        cargoTarget = "aarch64-apple-darwin"; cargoProfile = "release";
        tauri = {
          platform = "aarch64-darwin";
          root = ".";
          config = builtins.toPath ${JSON.stringify(path.join(root, "tauri.conf.json"))};
          frontend = builtins.toPath ${JSON.stringify(path.join(root, "frontend"))};
          capabilities = map builtins.toPath ${nixStrings(
            (policy.capabilityFiles || ["capabilities/default.json"]).map((value) =>
              path.join(root, value),
            ),
          )};
          permissions = map builtins.toPath ${nixStrings(
            (policy.permissionFiles || []).map((value) => path.join(root, value)),
          )};
          resources = [{
            path = builtins.toPath ${JSON.stringify(path.join(root, "help.txt"))};
            source = "help.txt";
            destination = "help/help.txt";
          }];
          icons = [ (builtins.toPath ${JSON.stringify(path.join(root, "icons/icon.png"))}) ];
          sidecars = [];
          appCommands = ${nixStrings(policy.appCommands || [])};
          appWindows = ${nixStrings(policy.appWindows || ["main"])};
        };
      };
    in result.preBuild
  `;
  return String(
    (
      await $({ cwd: sourceRoot, stdio: "pipe" })`
        ${nixBin} eval --impure --raw --expr ${expression}
      `
    ).stdout,
  );
}

export async function runScopedPolicy(root: string): Promise<number | null> {
  await fsp.mkdir(path.join(root, "permissions"), { recursive: true });
  await fsp.writeFile(
    path.join(root, "permissions/report.toml"),
    '[[permission]]\nidentifier = "allow-report-status"\ncommands.allow = ["report_status"]\n',
  );
  const script = await policyScript(root, {
    appCommands: ["report_status"],
    appWindows: ["main", "auth-popup"],
    capabilityFiles: ["capabilities/main.json", "capabilities/auth-popup.json"],
    permissionFiles: ["permissions/report.toml"],
  });
  await Promise.all([
    fsp.writeFile(
      path.join(root, "tauri.conf.json"),
      JSON.stringify(
        config({
          app: {
            withGlobalTauri: false,
            security: { csp: reviewedCsp, capabilities: ["main", "auth-popup"] },
            windows: [{ label: "main" }, { label: "auth-popup" }],
          },
        }),
      ),
    ),
    fsp.writeFile(
      path.join(root, "capabilities/main.json"),
      JSON.stringify({
        identifier: "main",
        permissions: ["core:default", "allow-report-status"],
        windows: ["main"],
      }),
    ),
    fsp.writeFile(
      path.join(root, "capabilities/auth-popup.json"),
      JSON.stringify({
        identifier: "auth-popup",
        permissions: [],
        windows: ["auth-popup"],
      }),
    ),
  ]);
  return (
    await $({
      cwd: root,
      reject: false,
      nothrow: true,
      stdio: "pipe",
    })`bash -c ${script}`
  ).exitCode;
}
