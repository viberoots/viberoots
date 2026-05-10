def sh_quote(value):
    if value == None:
        return "''"
    return "'" + str(value).replace("'", "'\"'\"'") + "'"

def asset_with_selector(asset):
    if not isinstance(asset, dict):
        fail("node_asset_stage: each asset must be a dict with src and dest")
    src = asset.get("src")
    dest = asset.get("dest")
    if src == None or src == "":
        fail("node_asset_stage: each asset requires non-empty src")
    if dest == None or dest == "":
        fail("node_asset_stage: each asset requires non-empty dest")
    artifact_name = asset.get("artifact_name")
    artifact_glob = asset.get("artifact_glob")
    if artifact_name != None and artifact_name != "" and artifact_glob != None and artifact_glob != "":
        fail("node_asset_stage: asset src %r cannot set both artifact_name and artifact_glob" % src)
    return struct(
        src = src,
        dest = dest,
        artifact_name = artifact_name,
        artifact_glob = artifact_glob,
    )

def validate_wasm_selector_args(macro_name, artifact_name, artifact_glob):
    if artifact_name != None and artifact_name != "" and artifact_glob != None and artifact_glob != "":
        fail("%s: cannot set both artifact_name and artifact_glob" % macro_name)

def wasm_source_resolver_shell():
    return (
        "resolve_node_source_path() { "
        + "MACRO=\"$1\"; RAW=\"$2\"; HINT=\"$3\"; "
        + "if [ -n \"$HINT\" ] && [ -e \"$HINT\" ]; then VBR_WASM_RESOLVED_PATH=\"$HINT\"; return 0; fi; "
        + "if [ -n \"$HINT\" ]; then "
        + "HINT_SRCDIR=\"$SRCDIR/$HINT\"; if [ -e \"$HINT_SRCDIR\" ]; then VBR_WASM_RESOLVED_PATH=\"$HINT_SRCDIR\"; return 0; fi; "
        + "HINT_WORKSPACE=\"$WORKSPACE_ROOT/$HINT\"; if [ -e \"$HINT_WORKSPACE\" ]; then VBR_WASM_RESOLVED_PATH=\"$HINT_WORKSPACE\"; return 0; fi; "
        + "HINT_STEM=\"$HINT\"; case \"$HINT_STEM\" in *.wasm) HINT_STEM=\"${HINT_STEM%.wasm}\" ;; esac; "
        + "if [ -n \"$HINT_STEM\" ] && [ -e \"$HINT_STEM\" ]; then VBR_WASM_RESOLVED_PATH=\"$HINT_STEM\"; return 0; fi; "
        + "HINT_STEM_SRCDIR=\"$SRCDIR/$HINT_STEM\"; if [ -e \"$HINT_STEM_SRCDIR\" ]; then VBR_WASM_RESOLVED_PATH=\"$HINT_STEM_SRCDIR\"; return 0; fi; "
        + "HINT_STEM_WORKSPACE=\"$WORKSPACE_ROOT/$HINT_STEM\"; if [ -e \"$HINT_STEM_WORKSPACE\" ]; then VBR_WASM_RESOLVED_PATH=\"$HINT_STEM_WORKSPACE\"; return 0; fi; "
        + "fi; "
        + "C1=\"$HINT\"; C2=\"$SRCDIR/$RAW\"; C3=\"$WORKSPACE_ROOT/$RAW\"; "
        + "if [ -e \"$C1\" ]; then VBR_WASM_RESOLVED_PATH=\"$C1\"; return 0; fi; "
        + "if [ -e \"$C2\" ]; then VBR_WASM_RESOLVED_PATH=\"$C2\"; return 0; fi; "
        + "if [ -e \"$C3\" ]; then VBR_WASM_RESOLVED_PATH=\"$C3\"; return 0; fi; "
        + "TARGET_NAME=\"$RAW\"; "
        + "case \"$TARGET_NAME\" in *:*) TARGET_NAME=\"${TARGET_NAME##*:}\" ;; */*) TARGET_NAME=\"${TARGET_NAME##*/}\" ;; esac; "
        + "if [ -n \"$TARGET_NAME\" ]; then "
        + "for P in \"$SRCDIR/$TARGET_NAME\" \"$SRCDIR/$TARGET_NAME.wasm\" \"$SRCDIR/$TARGET_NAME.js\"; do "
        + "if [ -e \"$P\" ]; then VBR_WASM_RESOLVED_PATH=\"$P\"; return 0; fi; "
        + "done; "
        + "MATCH=\"\"; AMBIG=\"\"; "
        + "for P in \"$SRCDIR\"/*\"$TARGET_NAME\"* \"$SRCDIR\"/*/*\"$TARGET_NAME\"*; do "
        + "if [ ! -e \"$P\" ]; then continue; fi; "
        + "if [ -z \"$MATCH\" ]; then MATCH=\"$P\"; else AMBIG=1; break; fi; "
        + "done; "
        + "if [ -n \"$MATCH\" ] && [ -z \"$AMBIG\" ]; then VBR_WASM_RESOLVED_PATH=\"$MATCH\"; return 0; fi; "
        + "fi; "
        + "WASM_ONE=\"\"; WASM_MULTI=\"\"; "
        + "for P in \"$SRCDIR\"/*.wasm \"$SRCDIR\"/*/*.wasm \"$SRCDIR\"/*/*/*.wasm; do "
        + "if [ ! -f \"$P\" ]; then continue; fi; "
        + "if [ -z \"$WASM_ONE\" ]; then WASM_ONE=\"$P\"; else WASM_MULTI=1; break; fi; "
        + "done; "
        + "if [ -n \"$WASM_ONE\" ] && [ -z \"$WASM_MULTI\" ]; then VBR_WASM_RESOLVED_PATH=\"$WASM_ONE\"; return 0; fi; "
        + "echo \"$MACRO: source not found for '$RAW'; checked: $C1 ; $C2 ; $C3\" >&2; "
        + "return 2; "
        + "}; "
        + "resolve_node_wasm_artifact() { "
        + "MACRO=\"$1\"; RAW=\"$2\"; CAND=\"$3\"; ARTIFACT_NAME=\"$4\"; ARTIFACT_GLOB=\"$5\"; "
        + "if [ -f \"$CAND\" ]; then VBR_WASM_RESOLVED_PATH=\"$CAND\"; return 0; fi; "
        + "if [ -n \"$ARTIFACT_NAME\" ]; then "
        + "if [ -d \"$CAND\" ]; then "
        + "NAMED=\"$CAND/$ARTIFACT_NAME\"; "
        + "if [ -f \"$NAMED\" ]; then VBR_WASM_RESOLVED_PATH=\"$NAMED\"; return 0; fi; "
        + "fi; "
        + "NAMED_ONE=\"\"; NAMED_MULTI=\"\"; "
        + "for N in \"$SRCDIR/$ARTIFACT_NAME\" \"$SRCDIR\"/*/\"$ARTIFACT_NAME\" \"$SRCDIR\"/*/*/\"$ARTIFACT_NAME\" \"$WORKSPACE_ROOT/$ARTIFACT_NAME\" \"$WORKSPACE_ROOT\"/*/\"$ARTIFACT_NAME\" \"$WORKSPACE_ROOT\"/*/*/\"$ARTIFACT_NAME\"; do "
        + "if [ ! -f \"$N\" ]; then continue; fi; "
        + "if [ -z \"$NAMED_ONE\" ]; then NAMED_ONE=\"$N\"; else NAMED_MULTI=1; break; fi; "
        + "done; "
        + "if [ -n \"$NAMED_ONE\" ] && [ -z \"$NAMED_MULTI\" ]; then VBR_WASM_RESOLVED_PATH=\"$NAMED_ONE\"; return 0; fi; "
        + "if [ -n \"$NAMED_MULTI\" ]; then "
        + "echo \"$MACRO: artifact_name '$ARTIFACT_NAME' matched multiple wasm artifacts for '$RAW'\" >&2; "
        + "return 2; "
        + "fi; "
        + "echo \"$MACRO: artifact_name '$ARTIFACT_NAME' not found for '$RAW' under '$CAND'\" >&2; "
        + "return 2; "
        + "fi; "
        + "if [ ! -d \"$CAND\" ]; then VBR_WASM_RESOLVED_PATH=\"$CAND\"; return 0; fi; "
        + "if [ -z \"$ARTIFACT_GLOB\" ] && [ -f \"$CAND/top.wasm\" ]; then "
        + "VBR_WASM_RESOLVED_PATH=\"$CAND/top.wasm\"; return 0; "
        + "fi; "
        + "FIRST=\"\"; HAS_MULTI=\"\"; MATCHES=\"\"; "
        + "for F in \"$CAND\"/*.wasm \"$CAND\"/*/*.wasm \"$CAND\"/*/*/*.wasm; do "
        + "if [ ! -f \"$F\" ]; then continue; fi; "
        + "REL=\"${F#$CAND/}\"; BASE=\"${F##*/}\"; "
        + "if [ -n \"$ARTIFACT_GLOB\" ]; then "
        + "case \"$REL\" in $ARTIFACT_GLOB) ;; "
        + "*) case \"$BASE\" in $ARTIFACT_GLOB) ;; *) continue ;; esac ;; "
        + "esac; "
        + "fi; "
        + "if [ -z \"$FIRST\" ]; then FIRST=\"$F\"; else HAS_MULTI=1; fi; "
        + "if [ -z \"$MATCHES\" ]; then MATCHES=\"$REL\"; else MATCHES=\"$MATCHES, $REL\"; fi; "
        + "done; "
        + "if [ -n \"$FIRST\" ] && [ -z \"$HAS_MULTI\" ]; then VBR_WASM_RESOLVED_PATH=\"$FIRST\"; return 0; fi; "
        + "if [ -z \"$FIRST\" ]; then "
        + "if [ -n \"$ARTIFACT_GLOB\" ]; then "
        + "echo \"$MACRO: no wasm artifact matched artifact_glob '$ARTIFACT_GLOB' for '$RAW' under '$CAND'\" >&2; "
        + "else "
        + "echo \"$MACRO: no wasm artifact found for '$RAW' under '$CAND'\" >&2; "
        + "fi; "
        + "return 2; "
        + "fi; "
        + "if [ -n \"$ARTIFACT_GLOB\" ]; then "
        + "echo \"$MACRO: artifact_glob '$ARTIFACT_GLOB' matched multiple wasm artifacts for '$RAW' under '$CAND': $MATCHES\" >&2; "
        + "else "
        + "echo \"$MACRO: ambiguous wasm artifacts for '$RAW' under '$CAND': $MATCHES. Set artifact_name (preferred) or artifact_glob to disambiguate.\" >&2; "
        + "fi; "
        + "return 2; "
        + "}; "
    )
