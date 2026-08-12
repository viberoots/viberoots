load(
    "@repo_toolchains//:toolchain_paths.bzl",
    "NIX_ARTIFACT_TOOLS_ROOT",
    "NIX_ARTIFACT_TRUSTED_PUBLIC_KEYS",
)
load("@viberoots//build-tools/lang:nix_cache_health.bzl", "nix_cache_health_shell")

def nix_artifact_bash():
    return NIX_ARTIFACT_TOOLS_ROOT + "/bin/bash"


def nix_canonical_dev_override_shell():
    encoded = read_config("viberoots", "dev_overrides", "")
    remaining = encoded
    for char in ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"]:
        remaining = remaining.replace(char, "")
    if remaining:
        fail("viberoots.dev_overrides must be canonical lowercase hex")
    if encoded:
        return "VBR_DEV_OVERRIDE_ARG=\"--dev-overrides=%s\"; " % encoded
    return "VBR_DEV_OVERRIDE_ARG=\"\"; "

def nix_artifact_policy_args():
    return (
        "--option sandbox true --option sandbox-fallback false --option sandbox-paths \"$VBR_ARTIFACT_SANDBOX_PATHS\" --option extra-sandbox-paths '' --option builders '' "
        + "--option trusted-public-keys '%s' " % " ".join(NIX_ARTIFACT_TRUSTED_PUBLIC_KEYS)
    )

def nix_artifact_tool_authority_shell():
    return (
        "export PATH=\"%s/bin\" VBR_ARTIFACT_TOOLS_ROOT=\"%s\"; " % (NIX_ARTIFACT_TOOLS_ROOT, NIX_ARTIFACT_TOOLS_ROOT)
        + "if [ -x /nix/var/nix/profiles/default/bin/nix ]; then NIX_BIN=/nix/var/nix/profiles/default/bin/nix; else NIX_BIN=\"%s/bin/nix\"; fi; " % NIX_ARTIFACT_TOOLS_ROOT
        + "test -x \"$NIX_BIN\" || { echo 'artifact action requires canonical Nix bootstrap or declared store nix' >&2; exit 127; }; "
        + "export NIX_BIN VBR_NIX_BIN=\"$NIX_BIN\"; "
        + "for VBR_TOOL in bash cat cp dirname find git grep ls mkdir mktemp nix nix-store node rm rsync sed sort tail timeout tr uname awk; do "
        + "VBR_TOOL_PATH=\"%s/bin/$VBR_TOOL\"; " % NIX_ARTIFACT_TOOLS_ROOT
        + "test -x \"$VBR_TOOL_PATH\" || { echo \"artifact action requires declared tool: $VBR_TOOL -> $VBR_TOOL_PATH\" >&2; exit 127; }; "
        + "done; "
        + "VBR_ACTION_TOOL_SOURCE_ROOT=\"$VBR_ARTIFACT_TOOLS_ROOT/share/viberoots-source\"; "
        + "test -f \"$VBR_ACTION_TOOL_SOURCE_ROOT/build-tools/tools/dev/zx-init.mjs\" || { echo 'artifact action tool closure is missing viberoots build tools' >&2; exit 127; }; "
        + "export VBR_ACTION_TOOL_SOURCE_ROOT; "
    )

def nix_artifact_environment_shell():
    return (
        "if [ -n \"${VBR_NIX_CACHE_ROLE_BINDING:-}\" ]; then "
        + "VBR_ACTION_ROLE_NODE=\"${VBR_ARTIFACT_TOOLS_ROOT:-}/bin/node\"; test -x \"$VBR_ACTION_ROLE_NODE\" || { echo 'error: proven Nix cache roles require canonical node' >&2; exit 1; }; "
        + "test \"${#VBR_NIX_CACHE_ROLE_BINDING}\" = 64 && case \"$VBR_NIX_CACHE_ROLE_BINDING\" in *[!0-9a-f]*) false ;; *) true ;; esac || { echo 'error: proven Nix cache role binding is malformed' >&2; exit 1; }; "
        + "case \"${VBR_NIX_CACHE_ROLE_POLICY:-}\" in auto|strict) ;; *) echo 'error: proven Nix cache role policy is malformed' >&2; exit 1 ;; esac; "
        + "fi; "
        + "VBR_ACTION_EFFECTIVE_NETRC=\"\"; VBR_ACTION_EFFECTIVE_SUBSTITUTERS=\"\"; VBR_ACTION_UNREVIEWED_NIX_CONFIG=\"${NIX_CONFIG:-}\"; "
        + "VBR_ACTION_CONFIG_FILE=\"`mktemp \"${TMPDIR:-${TMP:-/tmp}}/vbr-action-nix-config.XXXXXX\"`\"; "
        + "if \"$NIX_BIN\" config show > \"$VBR_ACTION_CONFIG_FILE\" 2>/dev/null; then "
        + "while IFS= read -r VBR_ACTION_CONFIG_LINE; do case \"$VBR_ACTION_CONFIG_LINE\" in netrc-file\\ =*) VBR_ACTION_EFFECTIVE_NETRC=\"${VBR_ACTION_CONFIG_LINE#*=}\"; VBR_ACTION_EFFECTIVE_NETRC=\"${VBR_ACTION_EFFECTIVE_NETRC#${VBR_ACTION_EFFECTIVE_NETRC%%[![:space:]]*}}\"; VBR_ACTION_EFFECTIVE_NETRC=\"${VBR_ACTION_EFFECTIVE_NETRC%${VBR_ACTION_EFFECTIVE_NETRC##*[![:space:]]}}\" ;; substituters\\ =*|extra-substituters\\ =*) VBR_ACTION_CONFIG_VALUE=\"${VBR_ACTION_CONFIG_LINE#*=}\"; VBR_ACTION_EFFECTIVE_SUBSTITUTERS=\"$VBR_ACTION_EFFECTIVE_SUBSTITUTERS $VBR_ACTION_CONFIG_VALUE\" ;; esac; done < \"$VBR_ACTION_CONFIG_FILE\"; "
        + "fi; "
        + "VBR_ACTION_BASELINE_SUBSTITUTERS=\"$VBR_ACTION_EFFECTIVE_SUBSTITUTERS\"; "
        + "if [ -n \"${VBR_NIX_CACHE_ROLE_BINDING:-}\" ]; then "
        + "VBR_ACTION_CONFIG_RETAINED=\"\"; while IFS= read -r VBR_ACTION_CONFIG_LINE; do case \"$VBR_ACTION_CONFIG_LINE\" in substituters\\ =*|extra-substituters\\ =*|connect-timeout\\ =*|stalled-download-timeout\\ =*|fallback\\ =*) ;; *) if [ -n \"$VBR_ACTION_CONFIG_LINE\" ]; then if [ -n \"$VBR_ACTION_CONFIG_RETAINED\" ]; then VBR_ACTION_CONFIG_RETAINED=\"${VBR_ACTION_CONFIG_RETAINED}\"$'\\n'\"${VBR_ACTION_CONFIG_LINE}\"; else VBR_ACTION_CONFIG_RETAINED=\"$VBR_ACTION_CONFIG_LINE\"; fi; fi ;; esac; done < \"$VBR_ACTION_CONFIG_FILE\"; "
        + "printf -v NIX_CONFIG '%s\\nsubstituters = %s\\nextra-substituters = %s\\nconnect-timeout = 3\\nstalled-download-timeout = 10\\nfallback = true' \"$VBR_ACTION_CONFIG_RETAINED\" \"$VBR_NIX_CACHE_ROLE_REQUIRED\" \"$VBR_NIX_CACHE_ROLE_OPTIONAL\"; export NIX_CONFIG; "
        + "VBR_ACTION_UNREVIEWED_NIX_CONFIG=\"$NIX_CONFIG\"; "
        + "\"$NIX_BIN\" config show > \"$VBR_ACTION_CONFIG_FILE\" 2>/dev/null || { echo 'error: reconstructed Nix cache config is invalid' >&2; exit 1; }; "
        + "VBR_ACTION_EFFECTIVE_SUBSTITUTERS=\"\"; while IFS= read -r VBR_ACTION_CONFIG_LINE; do case \"$VBR_ACTION_CONFIG_LINE\" in substituters\\ =*|extra-substituters\\ =*) VBR_ACTION_CONFIG_VALUE=\"${VBR_ACTION_CONFIG_LINE#*=}\"; VBR_ACTION_EFFECTIVE_SUBSTITUTERS=\"$VBR_ACTION_EFFECTIVE_SUBSTITUTERS $VBR_ACTION_CONFIG_VALUE\" ;; esac; done < \"$VBR_ACTION_CONFIG_FILE\"; "
        + "export VBR_ACTION_BASELINE_SUBSTITUTERS VBR_ACTION_EFFECTIVE_SUBSTITUTERS; "
        + "if ! \"$VBR_ACTION_ROLE_NODE\" -e 'const {createHash}=require(\"node:crypto\");const e=process.env,s=x=>[...new Set(String(x||\"\").trim().split(/\\s+/).filter(Boolean))].sort(),h=x=>createHash(\"sha256\").update(s(x).join(\"\\n\")).digest(\"hex\").slice(0,16),r=s(e.VBR_NIX_CACHE_ROLE_REQUIRED),o=s(e.VBR_NIX_CACHE_ROLE_OPTIONAL),u=[...new Set([...r,...o])].sort(),c=s(e.VBR_ACTION_EFFECTIVE_SUBSTITUTERS);if(u.length===c.length&&u.every((x,i)=>x===c[i]))process.exit(0);console.error(\"error: proven Nix cache roles do not match effective substituters \"+JSON.stringify({required:{count:r.length,digest:h(r.join(\" \"))},optional:{count:o.length,digest:h(o.join(\" \"))},boundUnion:{count:u.length,digest:h(u.join(\" \"))},baseline:{count:s(e.VBR_ACTION_BASELINE_SUBSTITUTERS).length,digest:h(e.VBR_ACTION_BASELINE_SUBSTITUTERS)},candidate:{count:c.length,digest:h(c.join(\" \"))}}));process.exit(1)'; then exit 1; fi; "
        + "fi; "
        + "rm -f \"$VBR_ACTION_CONFIG_FILE\"; "
        + "unset AR AS BUCK_GRAPH_JSON BUCK_QUERY_ROOTS BUCK_TARGET BUCK_TARGET_ATTR BUCK_TARGET_PLATFORM CC CFLAGS CLANG CPATH CPPFLAGS CXX CXXFLAGS GCC GOPATH GOROOT LD LDFLAGS LIBRARY_PATH NIX_PATH NODE NODE_OPTIONS NODE_PATH NPM_CONFIG_PREFIX PKG_CONFIG_PATH PNPM PNPM_HOME PYTHON PYTHONHASHSEED PYTHONHOME PYTHONNOUSERSITE PYTHONPATH RUSTC RUSTFLAGS RUSTUP_HOME CARGO_HOME SDKROOT UV VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_TOKEN VBR_FILTERED_FLAKE_SNAPSHOT VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG VBR_PNPM_FILTERED_SNAPSHOT_ROOT VBR_PNPM_FINAL_STORE VBR_PNPM_FINAL_STORE_IMPORTER; "
        + "for VBR_ENV_NAME in \"${!NIX_@}\"; do case \"$VBR_ENV_NAME\" in NIX_BIN|NIX_REMOTE|NIX_SSL_CERT_DIR|NIX_SSL_CERT_FILE) ;; *) unset \"$VBR_ENV_NAME\" ;; esac; done; "
        + "test -n \"${TMPDIR:-}\" || { echo 'artifact action requires runner-owned temporary state' >&2; exit 2; }; "
        + "VBR_ARTIFACT_STATE=\"`mktemp -d \"$TMPDIR/vbr-artifact-state.XXXXXX\"`\"; "
        + "trap 'rm -rf \"$VBR_ARTIFACT_STATE\"' EXIT; "
        + "mkdir -p \"$VBR_ARTIFACT_STATE/home\" \"$VBR_ARTIFACT_STATE/tmp\" \"$VBR_ARTIFACT_STATE/xdg-cache\" \"$VBR_ARTIFACT_STATE/xdg-config\" \"$VBR_ARTIFACT_STATE/xdg-data\"; "
        + "export HOME=\"$VBR_ARTIFACT_STATE/home\" TMPDIR=\"$VBR_ARTIFACT_STATE/tmp\" TMP=\"$VBR_ARTIFACT_STATE/tmp\" TEMP=\"$VBR_ARTIFACT_STATE/tmp\" XDG_CACHE_HOME=\"$VBR_ARTIFACT_STATE/xdg-cache\" XDG_CONFIG_HOME=\"$VBR_ARTIFACT_STATE/xdg-config\" XDG_DATA_HOME=\"$VBR_ARTIFACT_STATE/xdg-data\"; "
        + "export LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC SOURCE_DATE_EPOCH=1; "
        + "if [ -n \"$VBR_ACTION_EFFECTIVE_NETRC\" ] && [ -f \"$VBR_ACTION_EFFECTIVE_NETRC\" ] && [ -r \"$VBR_ACTION_EFFECTIVE_NETRC\" ]; then "
        + "(umask 077; cp \"$VBR_ACTION_EFFECTIVE_NETRC\" \"$VBR_ARTIFACT_STATE/netrc\"); "
        + "export VBR_ACTION_NETRC_MATERIALIZED=1 VBR_ACTION_NETRC_FILE=\"$VBR_ARTIFACT_STATE/netrc\"; "
        + "VBR_ACTION_CONFIG_RETAINED=\"\"; while IFS= read -r VBR_ACTION_CONFIG_LINE; do case \"$VBR_ACTION_CONFIG_LINE\" in netrc-file\\ =*) ;; *) if [ -n \"$VBR_ACTION_CONFIG_LINE\" ]; then if [ -n \"$VBR_ACTION_CONFIG_RETAINED\" ]; then VBR_ACTION_CONFIG_RETAINED=\"${VBR_ACTION_CONFIG_RETAINED}\"$'\\n'\"${VBR_ACTION_CONFIG_LINE}\"; else VBR_ACTION_CONFIG_RETAINED=\"$VBR_ACTION_CONFIG_LINE\"; fi; fi ;; esac; done <<< \"$VBR_ACTION_UNREVIEWED_NIX_CONFIG\"; "
        + "if [ -n \"$VBR_ACTION_CONFIG_RETAINED\" ]; then printf -v NIX_CONFIG '%s\\nnetrc-file = %s' \"$VBR_ACTION_CONFIG_RETAINED\" \"$VBR_ARTIFACT_STATE/netrc\"; else printf -v NIX_CONFIG 'netrc-file = %s' \"$VBR_ARTIFACT_STATE/netrc\"; fi; export NIX_CONFIG; "
        + "elif [ -n \"$VBR_ACTION_UNREVIEWED_NIX_CONFIG\" ]; then export NIX_CONFIG=\"$VBR_ACTION_UNREVIEWED_NIX_CONFIG\"; else unset NIX_CONFIG; fi; "
        + "if [ -n \"${VBR_NIX_CACHE_ROLE_BINDING:-}\" ]; then "
        + "VBR_ACTION_BINDING_FILE=\"${VBR_ACTION_CONFIG_FILE}.binding\"; "
        + "printf 'reviewed-cache-roles-v1\\0%s\\0%s\\0%s\\0%s' \"$VBR_NIX_CACHE_ROLE_POLICY\" \"$VBR_NIX_CACHE_ROLE_REQUIRED\" \"$VBR_NIX_CACHE_ROLE_OPTIONAL\" \"${NIX_CONFIG:-}\" | \"$VBR_ACTION_ROLE_NODE\" -e 'const {createHash}=require(\"node:crypto\");const b=[];process.stdin.on(\"data\",x=>b.push(x));process.stdin.on(\"end\",()=>{const raw=Buffer.concat(b),p=raw.toString(\"utf8\").split(\"\\0\"),h=x=>createHash(\"sha256\").update(x||\"\").digest(\"hex\").slice(0,16);process.stdout.write([createHash(\"sha256\").update(raw).digest(\"hex\"),h(p[1]),h(p[2]),h(p[3]),h(p[4]),Buffer.byteLength(p[4]||\"\")].join(\"\\t\")+\"\\n\")})' > \"$VBR_ACTION_BINDING_FILE\"; "
        + "IFS=$'\\t' read -r VBR_NIX_CACHE_ROLE_BINDING VBR_NIX_CACHE_BOUND_POLICY_DIGEST VBR_NIX_CACHE_BOUND_REQUIRED_DIGEST VBR_NIX_CACHE_BOUND_OPTIONAL_DIGEST VBR_NIX_CACHE_BOUND_CONFIG_DIGEST VBR_NIX_CACHE_BOUND_CONFIG_BYTES < \"$VBR_ACTION_BINDING_FILE\" || { echo 'error: failed to bind proven Nix cache roles' >&2; exit 1; }; "
        + "rm -f \"$VBR_ACTION_BINDING_FILE\"; export VBR_NIX_CACHE_ROLE_BINDING VBR_NIX_CACHE_BOUND_POLICY_DIGEST VBR_NIX_CACHE_BOUND_REQUIRED_DIGEST VBR_NIX_CACHE_BOUND_OPTIONAL_DIGEST VBR_NIX_CACHE_BOUND_CONFIG_DIGEST VBR_NIX_CACHE_BOUND_CONFIG_BYTES; "
        + "fi; "
        + "unset VBR_ACTION_EFFECTIVE_NETRC VBR_ACTION_EFFECTIVE_SUBSTITUTERS VBR_ACTION_BASELINE_SUBSTITUTERS VBR_ACTION_UNREVIEWED_NIX_CONFIG; "
    )

def nix_action_final_exec_function_shell():
    return (
        "__vbr_action_final_exec() { "
        + "unset VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_TOKEN; "
        + "if [ \"${VBR_NIX_CACHE_POLICY:-auto}\" = \"off\" ]; then unset NIX_CONFIG VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY; exec \"$@\"; fi; "
        + "unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY; "
        + nix_cache_health_shell()
        + "unset VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_TOKEN; "
        + "if [ \"${VBR_NIX_CACHE_HEALTH_APPLIED:-}\" = \"1\" ] && [ \"${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG+x}\" = \"x\" ]; then "
        + "case \"${VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY:-}\" in auto|strict) ;; *) echo 'action cache-review role policy is unavailable' >&2; return 1 ;; esac; "
        + "VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_TOKEN=\"${RANDOM}${RANDOM}-$$-${RANDOM}\"; "
        + "VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_PROOF=\"vbr-nix-cache-review@1\"$'\\n'\"$VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_TOKEN\"$'\\n'\"$VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY\"$'\\n'\"${VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS:-}\"$'\\n'\"${VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS:-}\"$'\\n'\"${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG:-}\"; "
        + "exec {VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD}<<<\"$VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_PROOF\"; unset VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_PROOF; "
        + "if [ \"$VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD\" -lt 10 ] || [ \"$VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD\" -gt 1024 ]; then echo 'action cache-review proof descriptor is out of bounds' >&2; return 1; fi; "
        + "export VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_TOKEN; "
        + "fi; "
        + "exec \"$@\"; "
        + "}; export -f __vbr_action_final_exec; "
    )

def nix_action_final_exec_prefix():
    return "\"$VBR_ARTIFACT_TOOLS_ROOT/bin/bash\" -c '__vbr_action_final_exec \"$@\"' vbr-action-final-exec "

def nix_bootstrap_env_core():
    return (
        "set -euo pipefail; "
        + nix_artifact_tool_authority_shell()
        + nix_canonical_dev_override_shell()
        + "VBR_ARTIFACT_SANDBOX_PATHS=''; case \"${OSTYPE:-}\" in darwin*) VBR_ARTIFACT_SANDBOX_PATHS=/bin/bash ;; esac; export VBR_ARTIFACT_SANDBOX_PATHS; "
        + "unset FLK_ROOT REPO_ROOT VBR_ACTION_TOOL_SOURCE_ROOT VIBEROOTS_FLAKE_INPUT_ROOT VIBEROOTS_ROOT VIBEROOTS_SOURCE_ROOT WORKSPACE_ROOT ZX_INIT; "
        + "if [ -z \"${XDG_CONFIG_HOME:-}\" ]; then "
        + "  CONF_HOME=\"${BUCK2_REAL_HOME:-${HOME:-}}\"; "
        + "  if [ -n \"$CONF_HOME\" ]; then export XDG_CONFIG_HOME=\"$CONF_HOME/.config\"; fi; "
        + "fi; "
        + "export TMP=\"${TMPDIR:-/tmp}\"; "
        + "WS_ENV=\"\"; "
        + "CAND_WS=\"$PWD\"; "
        + "while [ \"$CAND_WS\" != \"/\" ]; do "
        + "  if [ -f \"$CAND_WS/.viberoots/workspace/buck/workspace-root.env\" ]; then WS_ENV=\"$CAND_WS/.viberoots/workspace/buck/workspace-root.env\"; break; fi; "
        + "  if [ -f \"$CAND_WS/build-tools/tools/buck/workspace-root.env\" ]; then WS_ENV=\"$CAND_WS/build-tools/tools/buck/workspace-root.env\"; break; fi; "
        + "  CAND_WS=\"${CAND_WS%/*}\"; "
        + "  if [ -z \"$CAND_WS\" ]; then CAND_WS=\"/\"; fi; "
        + "done; "
        + "if [ -z \"$WS_ENV\" ] && [ -n \"${SRCS:-}\" ]; then for VBR_SRC in $SRCS; do case \"$VBR_SRC\" in */.viberoots/workspace/buck/workspace-root.env|.viberoots/workspace/buck/workspace-root.env) WS_ENV=\"$VBR_SRC\"; break ;; esac; done; fi; "
        + "if [ -n \"$WS_ENV\" ]; then case \"$WS_ENV\" in */.viberoots/workspace/buck/workspace-root.env) export WORKSPACE_ROOT=\"${WS_ENV%/.viberoots/workspace/buck/workspace-root.env}\" ;; .viberoots/workspace/buck/workspace-root.env) export WORKSPACE_ROOT=\"$PWD\" ;; esac; fi; "
        + "[ -n \"$WS_ENV\" ] && . \"$WS_ENV\" 2>/dev/null || true; "
        + "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-}\"; "
        + "if [ -z \"${WORKSPACE_ROOT:-}\" ]; then "
        + "  if [ -f \"$PWD/.viberoots/workspace/buck/graph.json\" ] || [ -f \"$PWD/build-tools/tools/buck/graph.json\" ]; then "
        + "    export WORKSPACE_ROOT=\"$PWD\"; "
        + "  else "
        + "    CAND=\"$PWD\"; "
        + "    while [ \"$CAND\" != \"/\" ]; do "
        + "      if [ -f \"$CAND/.viberoots/workspace/buck/graph.json\" ] || [ -f \"$CAND/build-tools/tools/buck/graph.json\" ]; then export WORKSPACE_ROOT=\"$CAND\"; break; fi; "
        + "      CAND=\"${CAND%/*}\"; "
        + "      if [ -z \"$CAND\" ]; then CAND=\"/\"; fi; "
        + "    done; "
        + "  fi; "
        + "fi; "
        + "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-$PWD}\"; "
        + "WS_PHYS_FILE=\"$TMP/vbr-workspace-root.phys\"; "
        + "(cd \"$WORKSPACE_ROOT\" 2>/dev/null && pwd -P > \"$WS_PHYS_FILE\") || true; "
        + "WS_PHYS=\"\"; read -r WS_PHYS < \"$WS_PHYS_FILE\" 2>/dev/null || true; "
        + "if [ -n \"$WS_PHYS\" ]; then WORKSPACE_ROOT=\"$WS_PHYS\"; fi; "
        + "if [ -f \"$WORKSPACE_ROOT/.viberoots/workspace/buck/workspace-root.env\" ]; then . \"$WORKSPACE_ROOT/.viberoots/workspace/buck/workspace-root.env\" 2>/dev/null || true; fi; "
        + "if [ -f \"$WORKSPACE_ROOT/build-tools/tools/buck/workspace-root.env\" ]; then . \"$WORKSPACE_ROOT/build-tools/tools/buck/workspace-root.env\" 2>/dev/null || true; fi; "
        + "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-$PWD}\"; "
        + nix_artifact_tool_authority_shell()
        + nix_artifact_environment_shell()
        + nix_action_final_exec_function_shell()
        + "FLK_ROOT=\"${FLK_ROOT:-}\"; "
        + "if [ -z \"${FLK_ROOT:-}\" ] || [ ! -f \"$FLK_ROOT/flake.nix\" ]; then "
        + "  FLK_ROOT=\"${WORKSPACE_ROOT:-${REPO_ROOT:-$PWD}}\"; "
        + "  if [ -f \"$FLK_ROOT/.viberoots/workspace/flake.nix\" ]; then FLK_ROOT=\"$FLK_ROOT/.viberoots/workspace\"; fi; "
        + "  if [ ! -f \"$FLK_ROOT/flake.nix\" ]; then "
        + "    SEARCH_FROM=\"${WORKSPACE_ROOT:-${REPO_ROOT:-$PWD}}\"; "
        + "    CAND=\"$SEARCH_FROM\"; "
        + "    while [ \"$CAND\" != \"/\" ] && [ ! -f \"$CAND/flake.nix\" ]; do "
        + "      if [ -f \"$CAND/.viberoots/workspace/flake.nix\" ]; then CAND=\"$CAND/.viberoots/workspace\"; break; fi; "
        + "      CAND=\"${CAND%/*}\"; "
        + "      if [ -z \"$CAND\" ]; then CAND=\"/\"; fi; "
        + "    done; "
        + "    FLK_ROOT=\"$CAND\"; "
        + "  fi; "
        + "  if [ ! -f \"$FLK_ROOT/flake.nix\" ]; then "
        + "    ROOT_GIT_FILE=\"$TMP/vbr-flk-root.git\"; "
        + "    if git -C \"${REPO_ROOT:-$WORKSPACE_ROOT}\" rev-parse --show-toplevel > \"$ROOT_GIT_FILE\" 2>/dev/null; then "
        + "      ROOT_GIT=\"\"; read -r ROOT_GIT < \"$ROOT_GIT_FILE\" 2>/dev/null || true; "
        + "    else "
        + "      ROOT_GIT=\"${REPO_ROOT:-$WORKSPACE_ROOT}\"; "
        + "    fi; "
        + "    FLK_ROOT=\"$ROOT_GIT\"; "
        + "  fi; "
        + "fi; "
        + "FLK_PHYS_FILE=\"$TMP/vbr-flk-root.phys\"; "
        + "(cd \"$FLK_ROOT\" 2>/dev/null && pwd -P > \"$FLK_PHYS_FILE\") || true; "
        + "FLK_PHYS=\"\"; read -r FLK_PHYS < \"$FLK_PHYS_FILE\" 2>/dev/null || true; "
        + "if [ -n \"$FLK_PHYS\" ]; then FLK_ROOT=\"$FLK_PHYS\"; fi; "
        + "VBR_ROOT=\"$VBR_ARTIFACT_TOOLS_ROOT/share/viberoots-source\"; test -f \"$VBR_ROOT/build-tools/tools/dev/zx-init.mjs\" || { echo 'artifact action tool closure is missing viberoots build tools' >&2; exit 127; }; "
        + "VBR_PHYS_FILE=\"$TMP/vbr-source-root.phys\"; (cd \"$VBR_ROOT\" 2>/dev/null && pwd -P > \"$VBR_PHYS_FILE\") || true; VBR_PHYS=\"\"; read -r VBR_PHYS < \"$VBR_PHYS_FILE\" 2>/dev/null || true; if [ -n \"$VBR_PHYS\" ]; then VBR_ROOT=\"$VBR_PHYS\"; fi; export VBR_ACTION_TOOL_SOURCE_ROOT=\"$VBR_ROOT\" VIBEROOTS_ROOT=\"$VBR_ROOT\"; "
        + "cd \"$WORKSPACE_ROOT\"; "
        + "test -f \"$FLK_ROOT/flake.nix\" || { echo \"nix bootstrap: missing flake.nix (WORKSPACE_ROOT=$WORKSPACE_ROOT FLK_ROOT=$FLK_ROOT checked hidden=$WORKSPACE_ROOT/.viberoots/workspace/flake.nix)\" >&2; exit 2; }; "
    )
def nix_bootstrap_env_pnpm_store():
    return (
        "VBR_UNIFIED_PNPM_PATH=\"\"; "
        + "if [ -n \"${REPO_ROOT:-}\" ] && [ -f \"$REPO_ROOT/.viberoots/workspace/buck/unified-pnpm-store/path\" ]; then VBR_UNIFIED_PNPM_PATH=\"$REPO_ROOT/.viberoots/workspace/buck/unified-pnpm-store/path\"; "
        + "elif [ -n \"${REPO_ROOT:-}\" ] && [ -f \"$REPO_ROOT/buck-out/.unified-pnpm-store/path\" ]; then VBR_UNIFIED_PNPM_PATH=\"$REPO_ROOT/buck-out/.unified-pnpm-store/path\"; "
        + "elif [ -f \"$FLK_ROOT/.viberoots/workspace/buck/unified-pnpm-store/path\" ]; then VBR_UNIFIED_PNPM_PATH=\"$FLK_ROOT/.viberoots/workspace/buck/unified-pnpm-store/path\"; "
        + "elif [ -f \"$FLK_ROOT/buck-out/.unified-pnpm-store/path\" ]; then VBR_UNIFIED_PNPM_PATH=\"$FLK_ROOT/buck-out/.unified-pnpm-store/path\"; "
        + "fi; "
        + "if [ -z \"${LOCAL_PNPM_STORE:-}\" ] && [ -n \"$VBR_UNIFIED_PNPM_PATH\" ]; then "
        + "  LOCAL_PNPM_STORE=\"\"; read -r LOCAL_PNPM_STORE < \"$VBR_UNIFIED_PNPM_PATH\" 2>/dev/null || true; "
        + "  if [ -n \"$LOCAL_PNPM_STORE\" ]; then "
        + "    export NIX_USE_PREFETCHED_PNPM_STORE=1; "
        + "    export LOCAL_PNPM_STORE; "
        + "  fi; "
        + "fi; "
        + "if [ \"${VBR_SKIP_REQUIRE_UNIFIED_PNPM_STORE:-}\" != \"1\" ]; then "
        + "  if [ -z \"${LOCAL_PNPM_STORE:-}\" ] && [ -z \"$VBR_UNIFIED_PNPM_PATH\" ]; then "
        + "    if command -v node >/dev/null 2>&1; then "
        + "      (cd \"$VIBEROOTS_ROOT\" && node \"$VIBEROOTS_ROOT/build-tools/tools/dev/require-unified-pnpm-store.ts\" >/dev/null 2>&1 || true); "
        + "    elif [ -n \"${NIX_BIN:-}\" ] && [ -x \"$NIX_BIN\" ]; then "
        + "      (cd \"$VIBEROOTS_ROOT\" && \"$NIX_BIN\" run --accept-flake-config \"path:$VIBEROOTS_ROOT#zx-wrapper\" -- \"$VIBEROOTS_ROOT/build-tools/tools/dev/require-unified-pnpm-store.ts\" >/dev/null 2>&1 || true); "
        + "    fi; "
        + "  fi; "
        + "fi; "
        + "if [ -z \"${LOCAL_PNPM_STORE:-}\" ] && [ -z \"$VBR_UNIFIED_PNPM_PATH\" ] && [ -f \"$FLK_ROOT/.viberoots/workspace/buck/unified-pnpm-store/path\" ]; then VBR_UNIFIED_PNPM_PATH=\"$FLK_ROOT/.viberoots/workspace/buck/unified-pnpm-store/path\"; fi; "
        + "if [ -z \"${LOCAL_PNPM_STORE:-}\" ] && [ -z \"$VBR_UNIFIED_PNPM_PATH\" ] && [ -f \"$FLK_ROOT/buck-out/.unified-pnpm-store/path\" ]; then VBR_UNIFIED_PNPM_PATH=\"$FLK_ROOT/buck-out/.unified-pnpm-store/path\"; fi; "
        + "if [ -z \"${LOCAL_PNPM_STORE:-}\" ] && [ -n \"$VBR_UNIFIED_PNPM_PATH\" ]; then "
        + "  export NIX_USE_PREFETCHED_PNPM_STORE=1; "
        + "  LOCAL_PNPM_STORE=\"\"; read -r LOCAL_PNPM_STORE < \"$VBR_UNIFIED_PNPM_PATH\" 2>/dev/null || true; "
        + "  export LOCAL_PNPM_STORE; "
        + "fi; "
    )

def nix_bootstrap_env():
    return nix_bootstrap_env_core()

def nix_timeout_wrapper_var(var_name = "TIMEOUT", default_sec = 600):
    tout = default_sec if type(default_sec) == "int" and default_sec > 0 else 600
    return (
        ("TOUT=%d; " % tout)
        + "RAW_VERIFY_TOUT=\"${VERIFY_TIMEOUT_SECS:-}\"; "
        + "RAW_TEST_NIX_TOUT=\"${TEST_NIX_TIMEOUT_SECS:-}\"; "
        + "RAW_PNPM_INSTALL_TOUT=\"${NIX_PNPM_INSTALL_TIMEOUT:-}\"; "
        + "for RAW_TOUT in \"$RAW_VERIFY_TOUT\" \"$RAW_TEST_NIX_TOUT\"; do "
        + "  if [ -n \"$RAW_TOUT\" ] && [ \"$RAW_TOUT\" -gt \"$TOUT\" ] 2>/dev/null; then TOUT=\"$RAW_TOUT\"; fi; "
        + "done; "
        + "if [ -n \"$RAW_PNPM_INSTALL_TOUT\" ] && [ \"$RAW_PNPM_INSTALL_TOUT\" -gt \"$TOUT\" ] 2>/dev/null; then TOUT=\"$RAW_PNPM_INSTALL_TOUT\"; fi; "
        + "export NIX_PNPM_INSTALL_TIMEOUT=\"$TOUT\"; "
        + "export VBR_ARTIFACT_COMMAND_TIMEOUT_SECS=\"$TOUT\"; "
        + "if command -v timeout >/dev/null 2>&1; then "
        + ("%s=\"timeout -k 2s ${TOUT}s\"; " % var_name)
        + "else "
        + "echo \"error: timeout not found on PATH (expected via direnv/devshell)\" 1>&2; exit 127; "
        + "fi; "
    )

def escape_buck_cmd_subst(s):
    if not isinstance(s, str):
        return s
    return s.replace("$(", "$$(")


def nix_cmd_prefix(
        timeout_var = "TIMEOUT",
        timeout_sec = 600,
        include_pnpm_store = False,
        escape_cmd_subst = True):
    boot = nix_bootstrap_env_core()
    if include_pnpm_store:
        boot = boot + nix_bootstrap_env_pnpm_store()
    # Back-compat: historically this helper escaped shell command substitutions ($(...)) so
    # callers could cquery cmd strings without Buck interpreting them as macros.
    # Current bootstraps avoid $(...) entirely, but keep the switch for existing call sites.
    if escape_cmd_subst:
        boot = escape_buck_cmd_subst(boot)
    return boot + nix_timeout_wrapper_var(var_name = timeout_var, default_sec = timeout_sec)

def nix_calling_genrule_bootstrap(
        timeout_var = "TIMEOUT",
        timeout_sec = 600,
        include_pnpm_store = False,
        source_workspace_root_env = False,
        skip_require_unified_pnpm_store = False,
        debug_env_var = "VBR_NIX_CALL_DEBUG"):
    """
    Standard bootstrap for genrule-style macros that invoke Nix.

    Responsibilities:
    - optionally source build-tools/tools/buck/workspace-root.env (when available as an input)
    - normalize REPO_ROOT from WORKSPACE_ROOT (for git-based flake root fallback)
    - optionally disable unified PNPM store enforcement (bundling and other special cases)
    - compose with nix_cmd_prefix(...) so call sites don't reassemble partial variants
    """
    pre = ""
    if source_workspace_root_env:
        pre = pre + "if [ -f .viberoots/workspace/buck/workspace-root.env ]; then . .viberoots/workspace/buck/workspace-root.env 2>/dev/null || true; elif [ -n \"${SRCDIR:-}\" ] && [ -f \"$SRCDIR/.viberoots/workspace/buck/workspace-root.env\" ]; then . \"$SRCDIR/.viberoots/workspace/buck/workspace-root.env\" 2>/dev/null || true; elif [ -f build-tools/tools/buck/workspace-root.env ]; then . build-tools/tools/buck/workspace-root.env 2>/dev/null || true; elif [ -n \"${SRCS:-}\" ]; then for VBR_SRC in $SRCS; do case \"$VBR_SRC\" in */.viberoots/workspace/buck/workspace-root.env|.viberoots/workspace/buck/workspace-root.env) if [ -f \"$VBR_SRC\" ]; then . \"$VBR_SRC\" 2>/dev/null || true; break; fi ;; esac; done; fi; "
    pre = pre + "if [ -n \"${WORKSPACE_ROOT:-}\" ]; then export REPO_ROOT=\"$WORKSPACE_ROOT\"; fi; "
    if skip_require_unified_pnpm_store:
        pre = pre + "export VBR_SKIP_REQUIRE_UNIFIED_PNPM_STORE=1; "
    if isinstance(debug_env_var, str) and debug_env_var != "":
        pre = pre + ("if [ \"${%s:-}\" = \"1\" ]; then set -x; fi; " % debug_env_var)

    return pre + nix_cmd_prefix(
        timeout_var = timeout_var,
        timeout_sec = timeout_sec,
        include_pnpm_store = include_pnpm_store,
        escape_cmd_subst = True,
    ) + nix_declared_action_inputs_manifest_cmd()

def nix_declared_action_inputs_manifest_cmd():
    """Materialize trusted Buck action inputs for filtered-source admission."""
    return (
        "VBR_ARTIFACT_TOOLS_MARKER=\"$VBR_ARTIFACT_STATE/artifact-tools-root\"; "
        + "if [ -e \"$VBR_ARTIFACT_TOOLS_MARKER\" ] || [ -L \"$VBR_ARTIFACT_TOOLS_MARKER\" ]; then "
        + "test ! -L \"$VBR_ARTIFACT_TOOLS_MARKER\" && test -f \"$VBR_ARTIFACT_TOOLS_MARKER\" || { echo 'declared artifact tool marker must remain a regular file' >&2; exit 2; }; "
        + "VBR_EXISTING_ARTIFACT_TOOLS_ROOT=\"\"; IFS= read -r VBR_EXISTING_ARTIFACT_TOOLS_ROOT < \"$VBR_ARTIFACT_TOOLS_MARKER\" || true; "
        + "test \"$VBR_EXISTING_ARTIFACT_TOOLS_ROOT\" = \"$VBR_ARTIFACT_TOOLS_ROOT\" || { echo 'declared artifact tool marker authority changed during the action' >&2; exit 2; }; "
        + "else printf '%s\\n' \"$VBR_ARTIFACT_TOOLS_ROOT\" > \"$VBR_ARTIFACT_TOOLS_MARKER\"; chmod 0444 \"$VBR_ARTIFACT_TOOLS_MARKER\"; fi; "
        + "if [ -z \"${VBR_BUCK_INPUTS:-}\" ]; then "
        + "VBR_BUCK_INPUTS_DIR=\"$VBR_ARTIFACT_STATE/declared-inputs\"; "
        + "mkdir -p \"$VBR_BUCK_INPUTS_DIR\"; VBR_BUCK_INPUTS=\"$VBR_BUCK_INPUTS_DIR/declared-inputs-$$.txt\"; : > \"$VBR_BUCK_INPUTS\"; "
        + "for VBR_INPUT in ${SRCS:-} \"$@\" \"${BUCK_GRAPH_JSON:-}\" \"${WORKSPACE_ROOT:-}/.viberoots/workspace/buck/workspace-root.env\" \"${FLK_ROOT:-}/flake.nix\"; do "
        + "  [ -n \"$VBR_INPUT\" ] || continue; case \"$VBR_INPUT\" in /*) VBR_INPUT_CANDIDATE=\"$VBR_INPUT\" ;; *) VBR_INPUT_CANDIDATE=\"${SCRATCH:-$PWD}/$VBR_INPUT\" ;; esac; "
        + "  [ -e \"$VBR_INPUT_CANDIDATE\" ] || continue; realpath \"$VBR_INPUT_CANDIDATE\" >> \"$VBR_BUCK_INPUTS\"; "
        + "done; sort -u \"$VBR_BUCK_INPUTS\" -o \"$VBR_BUCK_INPUTS\"; "
        + "fi; realpath \"$VBR_ARTIFACT_TOOLS_MARKER\" >> \"$VBR_BUCK_INPUTS\"; sort -u \"$VBR_BUCK_INPUTS\" -o \"$VBR_BUCK_INPUTS\"; "
    )

def nix_declared_action_transport_args():
    """Pass canonical Buck action selectors through argv, not ambient env."""
    return "--workspace-root-marker \"$WS_ENV\" --artifact-tools-marker \"$VBR_ARTIFACT_TOOLS_MARKER\" --buck-test-src \"$WORKSPACE_ROOT\" --buck-graph-json \"$BUCK_GRAPH_JSON\" --buck-action-state-root \"$VBR_ARTIFACT_STATE\""

def nix_calling_genrule_nix_build_out_path_prefix(
        flake_attr,
        timeout_var = "TIMEOUT",
        timeout_sec = 600,
        include_pnpm_store = False,
        source_workspace_root_env = False,
        skip_require_unified_pnpm_store = False,
        impure = False,
        debug_env_var = "VBR_NIX_CALL_DEBUG"):
    """
    Convenience helper for the common pattern:
      <bootstrap> + outPath=$$($TIMEOUT "$NIX_BIN" build ... --no-link --print-out-paths | tail -n1)
    """
    return nix_calling_genrule_bootstrap(
        timeout_var = timeout_var,
        timeout_sec = timeout_sec,
        include_pnpm_store = include_pnpm_store,
        source_workspace_root_env = source_workspace_root_env,
        skip_require_unified_pnpm_store = skip_require_unified_pnpm_store,
        debug_env_var = debug_env_var,
    ) + nix_build_out_path_cmd(flake_attr, timeout_var = timeout_var, impure = impure)


def nix_build_out_path_cmd(flake_attr, timeout_var = "TIMEOUT", impure = False, build_prefix = "", graph_target = ""):
    tout = ""
    if isinstance(timeout_var, str) and timeout_var != "":
        tout = "$%s " % timeout_var
    prefix = ""
    if isinstance(build_prefix, str) and build_prefix != "":
        prefix = build_prefix
        if not prefix.endswith(" "):
            prefix = prefix + " "
    imp = "--impure " if impure else ""
    ensure_graph = ""
    if isinstance(graph_target, str) and graph_target != "":
        ensure_graph = (
            "export BUCK_GRAPH_JSON=\"${BUCK_GRAPH_JSON:-$WORKSPACE_ROOT/.viberoots/workspace/buck/graph.json}\"; "
            + (
                "env BUCK_TEST_SRC=\"$WORKSPACE_ROOT\" WORKSPACE_ROOT=\"$WORKSPACE_ROOT\" BUCK_TARGET=\"%s\" BUCK_GRAPH_JSON=\"$BUCK_GRAPH_JSON\" "
                % graph_target
            )
            + "node --experimental-top-level-await --disable-warning=ExperimentalWarning --experimental-strip-types "
            + "--import \"$VIBEROOTS_ROOT/build-tools/tools/dev/zx-init.mjs\" "
            + "\"$VIBEROOTS_ROOT/build-tools/tools/buck/export-graph.ts\" --out \"$BUCK_GRAPH_JSON\"; "
        )
    return (
        ensure_graph +
        "OUT_PATHS_FILE=\"$TMP/vbr-nix-outpaths.txt\"; "
        + (
            tout +
            ("%s\"$NIX_BIN\" build %s --no-write-lock-file --accept-flake-config %s --option min-free 0 --option max-free 0 %s--no-link --print-out-paths > \"$OUT_PATHS_FILE\"; " % (prefix, flake_attr, nix_artifact_policy_args(), imp))
        )
        + "OUT_LAST_FILE=\"$OUT_PATHS_FILE.last\"; "
        + "tail -n1 \"$OUT_PATHS_FILE\" > \"$OUT_LAST_FILE\"; "
        + "outPath=\"\"; read -r outPath < \"$OUT_LAST_FILE\" 2>/dev/null || true; "
        + "test -n \"$outPath\"; "
    )

def nix_calling_env_export_buck_graph_json(graph_json_path = "$(location workspace_buck//:graph.json)"):
    return (
        ("VBR_DECLARED_GRAPH_INPUT=\"%s\"; " % graph_json_path)
        + "case \"$VBR_DECLARED_GRAPH_INPUT\" in /*) VBR_DECLARED_GRAPH=\"$VBR_DECLARED_GRAPH_INPUT\" ;; *) VBR_DECLARED_GRAPH=\"${SCRATCH:-$PWD}/$VBR_DECLARED_GRAPH_INPUT\" ;; esac; "
        + "test -f \"$VBR_DECLARED_GRAPH\" || { echo \"declared Buck graph is missing: $VBR_DECLARED_GRAPH\" >&2; exit 2; }; "
        + "VBR_DECLARED_GRAPH_REAL_FILE=\"$TMP/vbr-declared-graph.real\"; realpath \"$VBR_DECLARED_GRAPH\" > \"$VBR_DECLARED_GRAPH_REAL_FILE\"; "
        + "BUCK_GRAPH_JSON=\"\"; read -r BUCK_GRAPH_JSON < \"$VBR_DECLARED_GRAPH_REAL_FILE\"; "
        + "test -n \"$BUCK_GRAPH_JSON\" && grep -Fqx -- \"$BUCK_GRAPH_JSON\" \"$VBR_BUCK_INPUTS\" || { echo \"declared Buck graph is not present in the action-input manifest: $VBR_DECLARED_GRAPH\" >&2; exit 2; }; "
        + "export BUCK_GRAPH_JSON; "
    )

def nix_calling_env_export_source_snapshot(snapshot_root = "${1:-}", manifest_path = "${2:-}"):
    return (
        ("SOURCE_SNAPSHOT_ARG=\"%s\"; " % snapshot_root)
        + "if [ -n \"$SOURCE_SNAPSHOT_ARG\" ]; then "
        + "export DECLARED_SOURCE_SNAPSHOT_ROOT=\"$SOURCE_SNAPSHOT_ARG\"; "
        + ("export DECLARED_SOURCE_SNAPSHOT_MANIFEST=\"%s\"; " % manifest_path)
        + "export DECLARED_SOURCE_SNAPSHOT_GRAPH_JSON=\"$SOURCE_SNAPSHOT_ARG/.viberoots/workspace/buck/graph.json\"; "
        + "export SOURCE_SNAPSHOT_ROOT=\"$DECLARED_SOURCE_SNAPSHOT_ROOT\"; "
        + "export SOURCE_SNAPSHOT_MANIFEST=\"$DECLARED_SOURCE_SNAPSHOT_MANIFEST\"; "
        + "export BUCK_GRAPH_JSON=\"$DECLARED_SOURCE_SNAPSHOT_GRAPH_JSON\"; "
        + "export WORKSPACE_ROOT=\"$DECLARED_SOURCE_SNAPSHOT_ROOT\"; "
        + "export REPO_ROOT=\"$DECLARED_SOURCE_SNAPSHOT_ROOT\"; "
        + "export FLK_ROOT=\"$DECLARED_SOURCE_SNAPSHOT_ROOT\"; "
        + "fi; "
    )

def nix_calling_env_materialize_source_snapshot_for_execution(
        snapshot_root = "${1:-}",
        execution_root = "$TMP/vbr-source-snapshot",
        flake_file = "${2:-}",
        flake_lock = "${3:-}",
        node_modules_hashes = "${4:-}",
        nixpkgs_registry_extension = "${5:-}"):
    return (
        ("SOURCE_SNAPSHOT_EXECUTION_ARG=\"%s\"; " % snapshot_root)
        + "if [ -n \"$SOURCE_SNAPSHOT_EXECUTION_ARG\" ]; then "
        + "test -d \"$SOURCE_SNAPSHOT_EXECUTION_ARG\" || { echo \"declared source snapshot is not a directory: $SOURCE_SNAPSHOT_EXECUTION_ARG\" >&2; exit 2; }; "
        + ("SOURCE_SNAPSHOT_EXECUTION_ROOT=\"%s\"; " % execution_root)
        + "mkdir -p \"$SOURCE_SNAPSHOT_EXECUTION_ROOT\"; "
        + "\"$VBR_ARTIFACT_TOOLS_ROOT/bin/rsync\" -rlt --delete \"$SOURCE_SNAPSHOT_EXECUTION_ARG/\" \"$SOURCE_SNAPSHOT_EXECUTION_ROOT/\"; "
        + "\"$VBR_ARTIFACT_TOOLS_ROOT/bin/rm\" -rf \"$SOURCE_SNAPSHOT_EXECUTION_ROOT/build-tools\"; "
        + "mkdir -p \"$SOURCE_SNAPSHOT_EXECUTION_ROOT/build-tools\"; "
        + "\"$VBR_ARTIFACT_TOOLS_ROOT/bin/rsync\" -rlt --chmod=u+rwX --delete \"$VIBEROOTS_ROOT/build-tools/\" \"$SOURCE_SNAPSHOT_EXECUTION_ROOT/build-tools/\"; "
        + "mkdir -p \"$SOURCE_SNAPSHOT_EXECUTION_ROOT/.viberoots/workspace/buck\" \"$SOURCE_SNAPSHOT_EXECUTION_ROOT/projects/config\"; "
        + ("cp -f \"%s\" \"$SOURCE_SNAPSHOT_EXECUTION_ROOT/.viberoots/workspace/flake.nix\"; " % flake_file)
        + ("cp -f \"%s\" \"$SOURCE_SNAPSHOT_EXECUTION_ROOT/.viberoots/workspace/flake.lock\"; " % flake_lock)
        + ("cp -f \"%s\" \"$SOURCE_SNAPSHOT_EXECUTION_ROOT/projects/config/node-modules.hashes.json\"; " % node_modules_hashes)
        + ("if [ -n \"%s\" ]; then cp -f \"%s\" \"$SOURCE_SNAPSHOT_EXECUTION_ROOT/.viberoots/workspace/nixpkgs-source-registry-extension.nix\"; fi; " % (nixpkgs_registry_extension, nixpkgs_registry_extension))
        + "\"$VBR_ARTIFACT_TOOLS_ROOT/bin/git\" -C \"$SOURCE_SNAPSHOT_EXECUTION_ROOT\" init -q; "
        + "export WORKSPACE_ROOT=\"$SOURCE_SNAPSHOT_EXECUTION_ROOT\"; "
        + "export REPO_ROOT=\"$SOURCE_SNAPSHOT_EXECUTION_ROOT\"; "
        + "export FLK_ROOT=\"$SOURCE_SNAPSHOT_EXECUTION_ROOT/.viberoots/workspace\"; "
        + "export BUCK_GRAPH_JSON=\"$SOURCE_SNAPSHOT_EXECUTION_ROOT/.viberoots/workspace/buck/graph.json\"; "
        + "test -f \"$BUCK_GRAPH_JSON\" || { echo \"declared source snapshot is missing its graph: $BUCK_GRAPH_JSON\" >&2; exit 2; }; "
        + "WS_ENV=\"$SOURCE_SNAPSHOT_EXECUTION_ROOT/.viberoots/workspace/buck/workspace-root.env\"; : > \"$WS_ENV\"; "
        + "for VBR_MATERIALIZED_INPUT in \"$SOURCE_SNAPSHOT_EXECUTION_ROOT\" \"$BUCK_GRAPH_JSON\" \"$WS_ENV\" \"$FLK_ROOT/flake.nix\" \"$FLK_ROOT/flake.lock\" \"$SOURCE_SNAPSHOT_EXECUTION_ROOT/projects/config/node-modules.hashes.json\"; do realpath \"$VBR_MATERIALIZED_INPUT\" >> \"$VBR_BUCK_INPUTS\"; done; "
        + "sort -u \"$VBR_BUCK_INPUTS\" -o \"$VBR_BUCK_INPUTS\"; "
        + "fi; "
    )


def nix_calling_env_export_nix_pnpm_fetch_timeout(default_sec = 600):
    v = default_sec if type(default_sec) == "int" and default_sec > 0 else 600
    return ("export NIX_PNPM_FETCH_TIMEOUT=\"${NIX_PNPM_FETCH_TIMEOUT:-%d}\"; " % v)

def nix_calling_node_patch_requirements_preflight(importer):
    if not isinstance(importer, str) or importer == "":
        fail("nix_calling_node_patch_requirements_preflight: importer is required")
    return (
        ("VBR_NODE_PATCH_IMPORTER=\"%s\"; " % importer)
        + "VBR_NODE_ZX_INIT=\"$VIBEROOTS_ROOT/build-tools/tools/dev/zx-init.mjs\"; "
        + "test -f \"${BUCK_GRAPH_JSON:-}\" || { echo 'node patch preflight requires the declared Buck graph' >&2; exit 2; }; "
        + "node --experimental-top-level-await --disable-warning=ExperimentalWarning --experimental-strip-types --import \"$VBR_NODE_ZX_INIT\" \"$VIBEROOTS_ROOT/build-tools/tools/buck/enforce-node-patch-requirements.ts\" --check --importer \"$VBR_NODE_PATCH_IMPORTER\"; "
    )
