{ lib, config, pkgs, ... }:
let
  cfg = config.nixosSharedHost;

  nibbleValues = {
    "0" = 0;
    "1" = 1;
    "2" = 2;
    "3" = 3;
    "4" = 4;
    "5" = 5;
    "6" = 6;
    "7" = 7;
    "8" = 8;
    "9" = 9;
    "a" = 10;
    "b" = 11;
    "c" = 12;
    "d" = 13;
    "e" = 14;
    "f" = 15;
  };

  state =
    if cfg.statePath == null then
      { deployments = [ ]; }
    else
      builtins.fromJSON (builtins.readFile cfg.statePath);

  deployments = state.deployments or [ ];

  byteFromHex = hex:
    (nibbleValues.${builtins.substring 0 1 hex} * 16) + nibbleValues.${builtins.substring 1 1 hex};

  remainder = value: divisor: value - ((builtins.div value divisor) * divisor);

  safeOctet = byte: (remainder byte 253) + 1;

  backendAddressFor = deployment:
    let
      hash = builtins.hashString "sha256" deployment.providerTarget.sharedDevTargetIdentity;
      octet3 = safeOctet (byteFromHex (builtins.substring 0 2 hash));
      octet4 = safeOctet (byteFromHex (builtins.substring 2 2 hash));
    in
    {
      hostAddress = "10.233.${toString octet3}.${toString octet4}";
      localAddress = "10.234.${toString octet3}.${toString octet4}";
      backendAddress = "http://10.234.${toString octet3}.${toString octet4}:${toString deployment.runtime.containerPort}";
    };

  backendIdentityFor = deployment:
    "${deployment.providerTarget.containerName}:${toString deployment.runtime.containerPort}";

  containerRuntimeFor = deployment:
    if deployment.component.kind == "ssr-webapp" then
      {
        runtime = "ssr-webapp-host";
        publishRoot = "/srv/ssr-app/current";
        releaseRoot = "/srv/ssr-app/releases";
        activeReleaseLink = "/srv/ssr-app/live";
        serverEntry = "/srv/ssr-app/live/dist/server/index.js";
        clientDir = "/srv/ssr-app/live/dist/client";
      }
    else
      {
        runtime = "static-app-host";
        publishRoot = "/srv/static-app/current";
        releaseRoot = "/srv/static-app/releases";
        activeReleaseLink = "/srv/static-app/live";
        serverEntry = null;
        clientDir = null;
      };

  renderedEntries = map
    (deployment:
      let
        addr = backendAddressFor deployment;
        runtime = containerRuntimeFor deployment;
      in
      {
        inherit deployment addr runtime;
        containerName = deployment.providerTarget.containerName;
        hostname = deployment.providerTarget.hostname;
        backendIdentity = backendIdentityFor deployment;
      })
    deployments;

  duplicateValues = readKey:
    let
      grouped = lib.foldl'
        (acc: entry:
          let
            key = readKey entry;
          in
          acc
          // { "${key}" = (acc."${key}" or [ ]) ++ [ entry.deployment.label ]; })
        { }
        renderedEntries;
    in
    lib.filterAttrs (_: labels: builtins.length labels > 1) grouped;

  duplicateHostnames = duplicateValues (entry: entry.hostname);
  duplicateBackends = duplicateValues (entry: entry.backendIdentity);

  _conflictCheck =
    if duplicateHostnames != { } then
      throw
        (
          "duplicate hostname in nixos-shared-host module: "
          + lib.concatStringsSep ", " (
            lib.mapAttrsToList
              (key: labels: "${key} <- ${lib.concatStringsSep " | " labels}")
              duplicateHostnames
          )
        )
    else if duplicateBackends != { } then
      throw
        (
          "duplicate backend identity in nixos-shared-host module: "
          + lib.concatStringsSep ", " (
            lib.mapAttrsToList
              (key: labels: "${key} <- ${lib.concatStringsSep " | " labels}")
              duplicateBackends
          )
        )
    else
      true;

  rendered =
    lib.listToAttrs (map
      (entry:
        lib.nameValuePair entry.containerName {
          containerName = entry.containerName;
          targetGroup = entry.deployment.providerTarget.targetGroup;
          hostname = entry.hostname;
          backendIdentity = entry.backendIdentity;
          backendAddress = entry.addr.backendAddress;
          hostAddress = entry.addr.hostAddress;
          localAddress = entry.addr.localAddress;
          runtime = entry.runtime.runtime;
          containerPort = entry.deployment.runtime.containerPort;
          publishRoot = entry.runtime.publishRoot;
          releaseRoot = entry.runtime.releaseRoot;
          activeReleaseLink = entry.runtime.activeReleaseLink;
          serverEntry = entry.runtime.serverEntry;
          clientDir = entry.runtime.clientDir;
          healthPath = entry.deployment.runtime.healthPath or null;
        })
      renderedEntries);

  nginxVirtualHosts =
    lib.listToAttrs (map
      (entry:
        lib.nameValuePair entry.hostname {
          serverName = entry.hostname;
          backendIdentity = entry.backendIdentity;
          backendAddress = entry.addr.backendAddress;
          targetGroup = entry.deployment.providerTarget.targetGroup;
          healthPath = entry.deployment.runtime.healthPath or null;
          locations."/" = {
            proxyPass = entry.addr.backendAddress;
            proxyWebsockets = true;
          };
        })
      renderedEntries);

  containers =
    lib.listToAttrs (map
      (entry:
        lib.nameValuePair entry.containerName {
          autoStart = true;
          privateNetwork = true;
          hostAddress = entry.addr.hostAddress;
          localAddress = entry.addr.localAddress;
          config =
            { ... }:
            if entry.deployment.component.kind == "ssr-webapp" then
              {
                system.stateVersion = "24.11";
                environment.systemPackages = [ pkgs.nodejs ];
                systemd.services.nixos-shared-host-app = {
                  wantedBy = [ "multi-user.target" ];
                  serviceConfig = {
                    WorkingDirectory = "/srv/ssr-app/live";
                    ExecStart = "${pkgs.nodejs}/bin/node /srv/ssr-app/live/dist/server/index.js";
                    Restart = "always";
                  };
                  environment = {
                    PORT = toString entry.deployment.runtime.containerPort;
                    HOST = "0.0.0.0";
                  };
                };
                systemd.tmpfiles.rules = [
                  "d /srv/ssr-app 0755 root root -"
                  "d /srv/ssr-app/releases 0755 root root -"
                  "d /srv/ssr-app/releases/.empty 0755 root root -"
                  "L+ /srv/ssr-app/current - - - - /srv/ssr-app/releases/.empty"
                  "L+ /srv/ssr-app/live - - - - /srv/ssr-app/current"
                ];
              }
            else
              {
                system.stateVersion = "24.11";
                services.nginx = {
                  enable = true;
                  virtualHosts.localhost = {
                    listen = [
                      {
                        addr = "0.0.0.0";
                        port = entry.deployment.runtime.containerPort;
                      }
                    ];
                    root = "/srv/static-app/live";
                    locations."/" = {
                      tryFiles = "$uri $uri/ /index.html";
                    };
                  };
                };
                systemd.tmpfiles.rules = [
                  "d /srv/static-app 0755 root root -"
                  "d /srv/static-app/releases 0755 root root -"
                  "d /srv/static-app/releases/.empty 0755 root root -"
                  "L+ /srv/static-app/current - - - - /srv/static-app/releases/.empty"
                  "L+ /srv/static-app/live - - - - /srv/static-app/current"
                ];
              };
        })
      renderedEntries);
in
{
  options.nixosSharedHost = {
    enable = lib.mkEnableOption "nixos-shared-host realization";
    statePath = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
    };
    rendered = lib.mkOption {
      type = lib.types.attrs;
      readOnly = true;
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.statePath != null;
        message = "nixosSharedHost.statePath must be set when nixosSharedHost.enable = true";
      }
    ];

    nixosSharedHost.rendered = rendered;
    containers = lib.mkIf _conflictCheck containers;
    services.nginx.enable = true;
    services.nginx.virtualHosts = lib.mkIf _conflictCheck nginxVirtualHosts;
  };
}
