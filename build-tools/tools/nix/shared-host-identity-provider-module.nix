{ lib, config, pkgs, ... }:
let
  cfg = config.deploymentHost.identityProvider;
  bootstrap = import ./shared-host-identity-provider-bootstrap.nix {
    inherit lib;
    bootstrapFirstOperatorEmail = cfg.bootstrapFirstOperatorEmail;
    bootstrapClientRedirectUris = cfg.bootstrapClientRedirectUris;
    bootstrapTokenAudience = cfg.bootstrapTokenAudience;
    bootstrapTokenClaims = cfg.bootstrapTokenClaims;
  };
  localHost = "127.0.0.1";
  hostname = if cfg.hostname == null then "_disabled.invalid" else cfg.hostname;
  keycloakHttpPort = if cfg.keycloakHttpPort == null then 0 else cfg.keycloakHttpPort;
  publicUrl = "https://${hostname}";
  proxyUrl = "http://${localHost}:${toString keycloakHttpPort}";
  generatedImportDir = "/run/keycloak/data/import";
  generatedRealmFile =
    if cfg.generatedRealmFile != null then
      cfg.generatedRealmFile
    else
      "${cfg.generatedImportRoot}/deployment-auth-realm.json";
  generatedMembershipFile =
    if cfg.generatedMembershipFile != null then
      cfg.generatedMembershipFile
    else
      "${cfg.generatedImportRoot}/deployment-auth-memberships.json";
  generatedRealmImportName = builtins.baseNameOf generatedRealmFile;
  generatedMembershipImportName = builtins.baseNameOf generatedMembershipFile;
  generatedRealmBootstrapJson = builtins.toJSON bootstrap.realmImport;
  generatedMembershipBootstrapJson = builtins.toJSON bootstrap.membershipImport;
  migration = import ./shared-host-identity-provider-migration.nix {
    inherit
      lib
      config
      pkgs
      generatedRealmFile
      generatedMembershipFile
      generatedRealmBootstrapJson
      generatedMembershipBootstrapJson
      ;
    generatedImportRoot = cfg.generatedImportRoot;
    bootstrapFirstOperatorEmail = cfg.bootstrapFirstOperatorEmail;
    bootstrapFirstOperatorPasswordFile = cfg.bootstrapFirstOperatorPasswordFile;
  };
in
{
  options.deploymentHost.identityProvider =
    import ./shared-host-identity-provider-options.nix { inherit lib; };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.hostname != null;
        message = "deploymentHost.identityProvider.hostname must be set when the identity provider is enabled.";
      }
      {
        assertion = cfg.keycloakHttpPort != null;
        message = "deploymentHost.identityProvider.keycloakHttpPort must be set to an unused loopback port.";
      }
      {
        assertion = !cfg.manageAcme || cfg.acmeEmail != null;
        message = "deploymentHost.identityProvider.acmeEmail must be set when manageAcme is true.";
      }
      {
        assertion = lib.hasPrefix "/" cfg.generatedImportRoot;
        message = "deploymentHost.identityProvider.generatedImportRoot must be an absolute host path.";
      }
      {
        assertion = cfg.generatedRealmFile == null || lib.hasPrefix "/" cfg.generatedRealmFile;
        message = "deploymentHost.identityProvider.generatedRealmFile must be an absolute host path when set.";
      }
      {
        assertion =
          cfg.generatedMembershipFile == null || lib.hasPrefix "/" cfg.generatedMembershipFile;
        message = "deploymentHost.identityProvider.generatedMembershipFile must be an absolute host path when set.";
      }
      {
        assertion = cfg.bootstrapClientRedirectUris != [ ];
        message = ''
          deploymentHost.identityProvider.bootstrapClientRedirectUris must include at least one
          reviewed callback URI.
        '';
      }
      {
        assertion =
          cfg.bootstrapFirstOperatorPasswordFile == null
          || lib.hasPrefix "/" cfg.bootstrapFirstOperatorPasswordFile;
        message = "deploymentHost.identityProvider.bootstrapFirstOperatorPasswordFile must be an absolute host path when set.";
      }
      {
        assertion =
          cfg.bootstrapFirstOperatorPasswordFile == null || cfg.bootstrapFirstOperatorEmail != null;
        message = "deploymentHost.identityProvider.bootstrapFirstOperatorPasswordFile requires bootstrapFirstOperatorEmail.";
      }
      {
        assertion = !(cfg.realmFiles != [ ] && generatedRealmFile != null);
        message = ''
          deploymentHost.identityProvider.realmFiles is for static flake-visible imports; use
          generatedRealmFile for mutable generated deployment-auth realm JSON instead.
        '';
      }
    ];

    services.keycloak = {
      enable = true;
      package = lib.mkDefault pkgs.keycloak;
      database = {
        type = "postgresql";
        createLocally = true;
        passwordFile = cfg.databasePasswordFile;
      };
      settings = {
        hostname = lib.mkDefault publicUrl;
        http-enabled = lib.mkDefault true;
        http-host = lib.mkDefault localHost;
        http-port = lib.mkDefault keycloakHttpPort;
        proxy-headers = lib.mkDefault "xforwarded";
        hostname-backchannel-dynamic = lib.mkDefault true;
      };
      realmFiles = lib.mkDefault cfg.realmFiles;
    };

    systemd.tmpfiles.rules =
      [
        "d ${generatedImportDir} 0755 keycloak keycloak -"
      ]
      ++ lib.optionals (generatedRealmFile != null) [
        "L+ ${generatedImportDir}/${generatedRealmImportName} - - - - ${generatedRealmFile}"
      ]
      ++ lib.optionals (generatedMembershipFile != null) [
        "L+ ${generatedImportDir}/${generatedMembershipImportName} - - - - ${generatedMembershipFile}"
      ];

    systemd.services.deployment-host-keycloak-generated-import-bootstrap = lib.mkIf
      (generatedRealmFile != null || generatedMembershipFile != null)
      {
        description = "Bootstrap mutable generated Keycloak import files";
        before = [ "keycloak.service" ];
        requiredBy = [ "keycloak.service" ];
        serviceConfig.Type = "oneshot";
        script = migration.bootstrapManagedFilesScript;
      };

    systemd.services.keycloak.path = lib.mkAfter (with pkgs; [ coreutils jq ]);
    systemd.services.keycloak.serviceConfig.PermissionsStartOnly = true;
    systemd.services.keycloak.preStart = lib.mkAfter ''
      ${migration.bootstrapManagedFilesScript}
      ${migration.bootstrapAdminPreStart}
    '';
    systemd.services.keycloak.postStart = lib.mkAfter migration.bootstrapRealmMigrationPostStart;

    services.nginx = lib.mkIf cfg.manageNginx {
      enable = lib.mkDefault true;
      virtualHosts.${hostname} = {
        forceSSL = lib.mkDefault true;
        enableACME = lib.mkDefault cfg.manageAcme;
        locations."/" = {
          proxyPass = lib.mkDefault proxyUrl;
          proxyWebsockets = lib.mkDefault true;
          extraConfig = lib.mkAfter ''
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header X-Forwarded-Port 443;
            proxy_set_header X-Forwarded-Proto https;
          '';
        };
      };
    };

    security.acme = lib.mkIf (cfg.manageNginx && cfg.manageAcme) {
      acceptTerms = lib.mkDefault true;
      defaults.email = lib.mkDefault cfg.acmeEmail;
    };

    networking.firewall = lib.mkIf cfg.openFirewall {
      enable = lib.mkDefault true;
      allowedTCPPorts = [ 80 443 ];
    };
    environment.systemPackages = with pkgs; [ config.services.keycloak.package curl jq ];
  };
}
