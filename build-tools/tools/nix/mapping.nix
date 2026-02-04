{ ... }: {
  # Map Buck rule_type -> { template = "<lang>", kind = "bin"|"lib" }
  #
  # template:
  #   - Must match a language template exposed by build-tools/tools/nix/lang-templates.nix.
  #   - If you add a language later, ensure graph-generator.nix 'pick' knows
  #     how to route that template name and that lang-templates.nix exports it.
  #
  # kind:
  #   - "bin" => uses the language's binary/app template (currently goApp)
  #   - "lib" => uses the language's library template (currently goLib)
  #   - These must stay consistent with the template's exported function names in
  #     build-tools/tools/nix/lang-templates.nix and with graph-generator.nix 'mkGo' logic.
  #
  # Notes:
  #   - You DO NOT need entries for native go_* rules; those are handled by a
  #     go_ prefix check, and macros that stamp labels (e.g., ["lang:go"]) are
  #     also handled without a dispatch entry.
  #   - Only add entries for custom rule types (aliases) like "my_go_service" that
  #     don't start with go_ and may not carry the expected labels.
  dispatch = {
    # Examples (uncomment and adapt in your repo):
    # my_go_service = { template = "go"; kind = "bin"; };
    # my_go_lib  = { template = "go"; kind = "lib"; };
  };
}
