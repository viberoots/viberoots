{ ... }: {
  # Map Buck rule_type -> { template = "<lang>"; kind = "bin"|"lib" }
  # Keep this tiny and example-driven. Add entries only for custom rule types
  # that don't already start with canonical prefixes (e.g., non-`go_*`).
  dispatch = {
    # Examples (uncomment and adapt in your repo):
    # go_service = { template = "go"; kind = "bin"; };
    # my_go_lib  = { template = "go"; kind = "lib"; };
  };
}
