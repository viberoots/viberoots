{ config, lib, ... }:
let
  cfg = config.deploymentHost.deploymentService;
  hostname = if cfg.hostname == null then "_disabled.invalid" else cfg.hostname;
  proxyPass = "http://${cfg.localBindHost}:${toString cfg.localBindPort}";
  reviewedSourceSsh = cfg.reviewedSourceSsh;
  reviewedSourceSshEnvironmentEnabled = reviewedSourceSsh.privateKeyFile != null;
  githubKnownHostsPath = "/etc/deployment-host/github-known-hosts";
  reviewedSourceSshEnvironmentEtcPath = lib.removePrefix "/etc/" reviewedSourceSsh.environmentFile;
  reviewedSourceKnownHostsFile =
    if reviewedSourceSsh.knownHostsFile == null then githubKnownHostsPath else reviewedSourceSsh.knownHostsFile;
  githubKnownHosts = ''
    github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
    github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=
    github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=
  '';
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
    reviewedSourceSsh = {
      privateKeyFile = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = ''
          Runtime path to the SSH private key the deployment service and worker use
          when fetching reviewed GitHub source for private repositories.
        '';
      };
      knownHostsFile = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = ''
          Runtime path to the SSH known_hosts file used for reviewed GitHub source
          fetches. When unset, this module writes GitHub's pinned host keys under
          /etc/deployment-host/github-known-hosts.
        '';
      };
      environmentFile = lib.mkOption {
        type = lib.types.str;
        default = "/etc/deployment-host/reviewed-source-ssh.env";
        description = ''
          Host-local environment file consumed by deployment service and worker
          systemd units for reviewed-source SSH fetch credentials.
        '';
      };
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
      {
        assertion = lib.hasPrefix "/etc/" reviewedSourceSsh.environmentFile;
        message = "deploymentHost.deploymentService.reviewedSourceSsh.environmentFile must live under /etc.";
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

    environment.etc = lib.mkMerge [
      (lib.mkIf (reviewedSourceSshEnvironmentEnabled && reviewedSourceSsh.knownHostsFile == null) {
        "deployment-host/github-known-hosts" = {
          text = githubKnownHosts;
          mode = "0444";
        };
      })
      (lib.mkIf reviewedSourceSshEnvironmentEnabled {
        ${reviewedSourceSshEnvironmentEtcPath} = {
          text = ''
            BNX_DEPLOY_REVIEWED_SOURCE_SSH_KEY_FILE=${reviewedSourceSsh.privateKeyFile}
            BNX_DEPLOY_REVIEWED_SOURCE_SSH_KNOWN_HOSTS_FILE=${reviewedSourceKnownHostsFile}
          '';
          mode = "0440";
        };
      })
    ];
  };
}
