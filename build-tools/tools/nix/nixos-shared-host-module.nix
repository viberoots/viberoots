{ lib, config, ... }:
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

  renderedEntries = map
    (deployment:
      let
        addr = backendAddressFor deployment;
      in
      {
        inherit deployment addr;
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
          runtime = "static-app-host";
          containerPort = entry.deployment.runtime.containerPort;
          publishRoot = "/srv/static-app/current";
          releaseRoot = "/srv/static-app/releases";
          activeReleaseLink = "/srv/static-app/live";
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
