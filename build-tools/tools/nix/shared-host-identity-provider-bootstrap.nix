{ lib, bootstrapFirstOperatorEmail ? null, bootstrapClientRedirectUris ? [ ] }:
let
  normalizedBootstrapEmail =
    if bootstrapFirstOperatorEmail == null then
      null
    else
      let trimmed = lib.strings.trim bootstrapFirstOperatorEmail; in
      if trimmed == "" then null else lib.strings.toLower trimmed;
  uniqueSorted = values: builtins.sort builtins.lessThan (lib.unique values);
  bootstrapAdminGroups = [
    "deploy-admin-identity-read-global"
    "deploy-admin-identity-shape-admin-global"
    "deploy-admin-identity-membership-admin-global"
  ];
  bootstrapRedirectUris = uniqueSorted (
    builtins.filter (value: value != "") (map lib.strings.trim bootstrapClientRedirectUris)
  );
  groupsMapper = {
    name = "groups";
    protocol = "openid-connect";
    protocolMapper = "oidc-group-membership-mapper";
    consentRequired = false;
    config = {
      "claim.name" = "groups";
      "full.path" = "false";
      "id.token.claim" = "true";
      "access.token.claim" = "true";
      "userinfo.token.claim" = "true";
    };
  };
  emailMapper = {
    name = "email";
    protocol = "openid-connect";
    protocolMapper = "oidc-usermodel-property-mapper";
    consentRequired = false;
    config = {
      "user.attribute" = "email";
      "claim.name" = "email";
      "jsonType.label" = "String";
      "id.token.claim" = "true";
      "access.token.claim" = "true";
      "userinfo.token.claim" = "true";
    };
  };
in
{
  realmImport = {
    realm = "deployments";
    enabled = true;
    groups = map (name: { inherit name; }) bootstrapAdminGroups;
    clients = [
      {
        clientId = "deployment-cli";
        name = "deployment-cli";
        enabled = true;
        publicClient = true;
        protocol = "openid-connect";
        directAccessGrantsEnabled = true;
        redirectUris = bootstrapRedirectUris;
        protocolMappers = [ groupsMapper emailMapper ];
      }
    ];
  };
  membershipImport = {
    realm = "deployments";
    enabled = true;
    users =
      if normalizedBootstrapEmail == null then
        [ ]
      else
        [
          {
            username = normalizedBootstrapEmail;
            email = normalizedBootstrapEmail;
            enabled = true;
            emailVerified = true;
            groups = bootstrapAdminGroups;
            attributes = {
              "deploy-admin-bootstrap" = [ "true" ];
            };
          }
        ];
  };
}
