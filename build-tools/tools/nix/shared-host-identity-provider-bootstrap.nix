{
  lib,
  bootstrapFirstOperatorEmail ? null,
  bootstrapClientRedirectUris ? [ ],
  bootstrapTokenAudience ? "deployments-vault",
  bootstrapTokenClaims ? { },
}:
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
  normalizedBootstrapTokenAudience =
    if bootstrapTokenAudience == null then
      null
    else
      let trimmed = lib.strings.trim bootstrapTokenAudience; in
      if trimmed == "" then null else trimmed;
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
  audienceMappers =
    if normalizedBootstrapTokenAudience == null then
      [ ]
    else
      [
        {
          name = "audience";
          protocol = "openid-connect";
          protocolMapper = "oidc-audience-mapper";
          consentRequired = false;
          config = {
            "included.custom.audience" = normalizedBootstrapTokenAudience;
            "id.token.claim" = "false";
            "access.token.claim" = "true";
          };
        }
      ];
  tokenClaimMappers = map (claimName: {
    name = claimName;
    protocol = "openid-connect";
    protocolMapper = "oidc-hardcoded-claim-mapper";
    consentRequired = false;
    config = {
      "claim.name" = claimName;
      "claim.value" = bootstrapTokenClaims.${claimName};
      "jsonType.label" = "String";
      "id.token.claim" = "false";
      "access.token.claim" = "true";
      "userinfo.token.claim" = "false";
    };
  }) (builtins.attrNames bootstrapTokenClaims);
  tokenMappers = audienceMappers ++ tokenClaimMappers;
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
        protocolMappers = [ groupsMapper emailMapper ] ++ tokenMappers;
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
