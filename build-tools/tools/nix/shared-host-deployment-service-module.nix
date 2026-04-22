{ config, lib, ... }:
let
  cfg = config.deploymentHost.deploymentService;
  hostname = if cfg.hostname == null then "_disabled.invalid" else cfg.hostname;
  proxyPass = "http://${cfg.localBindHost}:${toString cfg.localBindPort}";
in
{
  options.deploymentHost.deploymentService = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Enable reviewed HTTPS ingress for the hosted deployment service.";
    };
    hostname = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Public hostname used by laptop clients for deployment service API calls.";
    };
    localBindHost = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Private local address where the deployment service listens.";
    };
    localBindPort = lib.mkOption {
      type = lib.types.port;
      default = 7780;
      description = "Private local port where the deployment service listens.";
    };
    manageNginx = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether this module manages the nginx virtual host.";
    };
    manageAcme = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether this module enables ACME on the service virtual host.";
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
        message = "deploymentHost.deploymentService.hostname must be set.";
      }
      {
        assertion = cfg.localBindHost != "0.0.0.0" && cfg.localBindHost != "::";
        message = "deploymentHost.deploymentService.localBindHost must be private.";
      }
      {
        assertion = !cfg.manageAcme || cfg.acmeEmail != null;
        message = "deploymentHost.deploymentService.acmeEmail must be set when manageAcme is true.";
      }
    ];

    services.nginx = lib.mkIf cfg.manageNginx {
      enable = lib.mkDefault true;
      virtualHosts.${hostname} = {
        forceSSL = lib.mkDefault true;
        enableACME = lib.mkDefault cfg.manageAcme;
        locations."/" = {
          proxyPass = lib.mkDefault proxyPass;
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
  };
}
