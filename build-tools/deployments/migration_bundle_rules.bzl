def _canonical_label(dep):
    label = str(dep.label)
    if label.startswith("root//"):
        label = label[4:]
    if " (" in label:
        label = label.split(" (")[0]
    return label

def _migration_bundle_impl(ctx):
    migration_sets = [_canonical_label(dep) for dep in ctx.attrs.migration_sets]
    migration_outputs = []
    for dep in ctx.attrs.migration_sets:
        outputs = dep[DefaultInfo].default_outputs
        if len(outputs) != 1:
            fail("migration_bundle migration_sets entries must expose exactly one default output: %s" % dep.label)
        migration_outputs.append(outputs[0])
    doc = {
        "schema_version": "deployment-migration-bundle@1",
        "name": ctx.label.name,
        "migration_sets": migration_sets,
        "ordered_migration_sets": [
            {
                "order": str(index),
                "target": target,
                "identity": target,
            }
            for index, target in enumerate(migration_sets)
        ],
        "dependency_graph_fingerprint": "migration-sets:" + "|".join(migration_sets),
    }
    manifest = ctx.actions.write_json(ctx.label.name + ".json", doc)
    out = ctx.actions.declare_output(ctx.label.name, dir = True)
    args = cmd_args(["bash", "-c", """
set -euo pipefail
out="$1"
manifest="$2"
shift 2
rm -rf "$out"
mkdir -p "$out/migrations"
cp "$manifest" "$out/manifest.json"
index=0
while [ "$#" -gt 0 ]; do
  label="$1"
  src="$2"
  shift 2
  safe="$(printf '%s' "$label" | sed -E 's#^//##; s#[^A-Za-z0-9._-]+#_#g')"
  dest="$out/migrations/$(printf '%03d' "$index")_$safe"
  mkdir -p "$dest"
  if [ -d "$src" ]; then
    cp -R "$src"/. "$dest"/
  else
    cp "$src" "$dest"/
  fi
  index=$((index + 1))
done
""", "migration_bundle", out.as_output(), manifest], hidden = migration_outputs)
    for index, migration_set in enumerate(migration_sets):
        args.add(migration_set)
        args.add(migration_outputs[index])
    ctx.actions.run(args, category = "migration_bundle")
    return [DefaultInfo(default_output = out, other_outputs = [manifest])]

migration_bundle = rule(
    impl = _migration_bundle_impl,
    attrs = {
        "migration_sets": attrs.list(attrs.dep()),
        "labels": attrs.list(attrs.string(), default = []),
    },
)
