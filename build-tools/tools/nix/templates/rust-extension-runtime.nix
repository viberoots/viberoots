{ pkgs, lib, kind, runtimePackages }:
let
  runtimeRoots = lib.concatStringsSep " "
    (map (package: lib.escapeShellArg "${package}/lib") runtimePackages);
  extensionFind =
    if kind == "pyext"
    then ''find "$out/site" -type f -name '*.so' -print -quit''
    else ''find "$out/lib" -maxdepth 1 -type f -name '*.node' -print -quit'';
  dependencyReferences =
    if pkgs.stdenv.isDarwin then
      ''references="$(${pkgs.darwin.cctools}/bin/otool -L "$binary" | tail -n +2 | awk '{print $1}')"''
    else
      ''references="$(${pkgs.glibc.bin}/bin/ldd "$binary" 2>/dev/null | awk '/=> \\/nix\\/store\\// {print $3}')"'';
  relocateBinary =
    if pkgs.stdenv.isDarwin then ''
      references="$(${pkgs.darwin.cctools}/bin/otool -L "$binary" | tail -n +2 | awk '{print $1}')"
      while IFS= read -r reference; do
        case "$reference" in
          /nix/store/*)
            replacement="@loader_path/$(if [ "$(dirname "$binary")" = "$runtime_dir" ]; then printf '%s' "$(basename "$reference")"; else printf 'runtime/%s' "$(basename "$reference")"; fi)"
            ${pkgs.darwin.cctools}/bin/install_name_tool -change "$reference" "$replacement" "$binary"
            ;;
        esac
      done <<EOF
  $references
  EOF
    '' else ''
      if [ "$(dirname "$binary")" = "$runtime_dir" ]; then
        ${pkgs.patchelf}/bin/patchelf --set-rpath '$ORIGIN' "$binary"
      else
        ${pkgs.patchelf}/bin/patchelf --set-rpath '$ORIGIN/runtime' "$binary"
      fi
    '';
in
lib.optionalString (runtimePackages != []) ''
  extension_file="$(${extensionFind})"
  if [ -z "$extension_file" ]; then
    echo "Rust ${kind} runtime closure: installed extension was not found" >&2
    exit 2
  fi
  runtime_dir="$(dirname "$extension_file")/runtime"
  mkdir -p "$runtime_dir"

  copy_runtime_library() {
    source_file="$1"
    destination="$runtime_dir/$(basename "$source_file")"
    if [ -e "$destination" ]; then
      cmp -s "$source_file" "$destination" || {
        echo "Rust ${kind} runtime closure has a library-name collision: $(basename "$source_file")" >&2
        exit 2
      }
      return
    fi
    cp -L "$source_file" "$destination"
    chmod u+w "$destination"
  }

  for package_lib in ${runtimeRoots}; do
    [ -d "$package_lib" ] || continue
    while IFS= read -r library; do copy_runtime_library "$library"; done < <(
      find "$package_lib" -maxdepth 1 -type f \
        \( -name '*.so' -o -name '*.so.*' -o -name '*.dylib' \) -print | sort
    )
  done

  changed=1
  while [ "$changed" -eq 1 ]; do
    changed=0
    while IFS= read -r binary; do
      ${dependencyReferences}
      while IFS= read -r reference; do
        [ -n "$reference" ] || continue
        case "$reference" in
          /nix/store/*)
            before="$(find "$runtime_dir" -maxdepth 1 -type f | wc -l)"
            copy_runtime_library "$reference"
            after="$(find "$runtime_dir" -maxdepth 1 -type f | wc -l)"
            [ "$after" -gt "$before" ] && changed=1
            ;;
        esac
      done <<EOF
  $references
  EOF
    done < <(find "$(dirname "$extension_file")" -type f \( -name '*.node' -o -name '*.so' -o -name '*.so.*' -o -name '*.dylib' \) -print)
  done

  while IFS= read -r binary; do
    ${relocateBinary}
  done < <(find "$(dirname "$extension_file")" -type f \( -name '*.node' -o -name '*.so' -o -name '*.so.*' -o -name '*.dylib' \) -print)
''
