{ lib }:
{
  enable = lib.mkOption {
    type = lib.types.bool;
    default = false;
    description = "Enable the reviewed Keycloak identity-provider defaults for a deployment host.";
  };
  hostname = lib.mkOption {
    type = lib.types.nullOr lib.types.str;
    default = null;
    description = "Public hostname for the deployment-host OIDC issuer.";
  };
  acmeEmail = lib.mkOption {
    type = lib.types.nullOr lib.types.str;
    default = null;
    description = "ACME account email used when this module manages certificates.";
  };
  keycloakHttpPort = lib.mkOption {
    type = lib.types.nullOr lib.types.port;
    default = null;
    description = "Loopback HTTP port used by Keycloak behind nginx.";
  };
  databasePasswordFile = lib.mkOption {
    type = lib.types.str;
    default = "/var/lib/deployment-host-secrets/keycloak-db-password";
    description = "Out-of-store file containing the local Keycloak database password.";
  };
  realmFiles = lib.mkOption {
    type = lib.types.listOf lib.types.path;
    default = [ ];
    description = "Reviewed Keycloak realm import files to apply during rebuild or switch.";
  };
  generatedImportRoot = lib.mkOption {
    type = lib.types.str;
    default = "/etc/nixos/deployment-host/identity-provider";
    description = ''
      Absolute host path used for mutable generated Keycloak import JSON. Keep this outside
      services.keycloak.realmFiles so flake evaluation does not depend on gitignored artifacts.
    '';
  };
  generatedRealmFile = lib.mkOption {
    type = lib.types.nullOr lib.types.str;
    default = null;
    description = ''
      Absolute host path for the mutable deployment-auth realm shape import. Null derives
      ${"deployment-auth-realm.json"} under generatedImportRoot.
    '';
  };
  generatedMembershipFile = lib.mkOption {
    type = lib.types.nullOr lib.types.str;
    default = null;
    description = ''
      Absolute host path for the mutable deployment-auth membership import. Null derives
      ${"deployment-auth-memberships.json"} under generatedImportRoot.
    '';
  };
  bootstrapClientRedirectUris = lib.mkOption {
    type = lib.types.listOf lib.types.str;
    default = [ ];
    description = ''
      Reviewed redirect URIs bootstrapped for the public human deploy-auth client before the
      normal identity sync flow runs. Set this explicitly for the reviewed browser-facing
      callback host you route to the deployment service.
    '';
  };
  bootstrapFirstOperatorEmail = lib.mkOption {
    type = lib.types.nullOr lib.types.str;
    default = null;
    description = ''
      Optional first trusted human email to seed into the mutable bootstrap membership import
      with reviewed identity-admin rights.
    '';
  };
  bootstrapFirstOperatorPasswordFile = lib.mkOption {
    type = lib.types.nullOr lib.types.str;
    default = null;
    description = ''
      Optional host-secret path containing a bootstrap-only temporary password for the first
      trusted human. The migration reads this at activation time and sets it once.
    '';
  };
  bootstrapTokenAudience = lib.mkOption {
    type = lib.types.nullOr lib.types.str;
    default = "deployments-vault";
    description = ''
      Optional reviewed audience emitted into bootstrap human deployment access tokens.
    '';
  };
  bootstrapTokenClaims = lib.mkOption {
    type = lib.types.attrsOf lib.types.str;
    default = { };
    description = ''
      Optional reviewed hardcoded access-token claims emitted during bootstrap, such as
      deployment_environment and repository.
    '';
  };
  manageNginx = lib.mkOption {
    type = lib.types.bool;
    default = false;
    description = "Whether this module manages the nginx virtual host.";
  };
  manageAcme = lib.mkOption {
    type = lib.types.bool;
    default = false;
    description = "Whether this module manages ACME defaults for the identity host.";
  };
  openFirewall = lib.mkOption {
    type = lib.types.bool;
    default = false;
    description = "Whether this module opens HTTP and HTTPS firewall ports.";
  };
}
