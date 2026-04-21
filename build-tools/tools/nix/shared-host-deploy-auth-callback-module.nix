{ config, lib, ... }:
let
  cfg = config.deploymentHost.deployAuthCallback;
  hostname = if cfg.hostname == null then "_disabled.invalid" else cfg.hostname;
  proxyPass = "http://${cfg.localBindHost}:${toString cfg.localBindPort}${cfg.callbackPath}";
in
{
  options.deploymentHost.deployAuthCallback = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Enable the reviewed PKCE callback reverse-proxy route for a deploy host.";
    };
    hostname = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Public hostname used in reviewed PKCE redirect URIs.";
    };
    callbackPath = lib.mkOption {
      type = lib.types.str;
      default = "/oidc/callback";
      description = "Public and local callback path routed to the deployment service.";
    };
    localBindHost = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Local host where the deployment service binds.";
    };
    localBindPort = lib.mkOption {
      type = lib.types.port;
      default = 7780;
      description = "Stable local port where the deployment service listens.";
    };
    manageNginx = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether this module manages the nginx virtual host.";
    };
    manageAcme = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether this module enables ACME on the callback virtual host.";
    };
    acmeEmail = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "ACME account email used when this module manages certificates.";
    };
    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether this module opens HTTP and HTTPS for the reverse proxy.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.hostname != null;
        message = "deploymentHost.deployAuthCallback.hostname must be set.";
      }
      {
        assertion = lib.hasPrefix "/" cfg.callbackPath;
        message = "deploymentHost.deployAuthCallback.callbackPath must be absolute.";
      }
      {
        assertion = !cfg.manageAcme || cfg.acmeEmail != null;
        message = "deploymentHost.deployAuthCallback.acmeEmail must be set when manageAcme is true.";
      }
    ];

    services.nginx = lib.mkIf cfg.manageNginx {
      enable = lib.mkDefault true;
      virtualHosts.${hostname} = {
        forceSSL = lib.mkDefault true;
        enableACME = lib.mkDefault cfg.manageAcme;
        locations.${cfg.callbackPath} = {
          proxyPass = lib.mkDefault proxyPass;
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
  };
}
