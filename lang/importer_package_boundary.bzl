_ERROR_PREFIX = "Importer-local patches must be wired from the importer package"

def require_importer_package_boundary(importer):
    """
    Importer-local patches live under <importer>/patches/<lang> and are attached via native.glob.
    Buck package boundaries prevent native.glob from reaching across packages, so a target defined
    in a subpackage cannot reliably include importer-local patches from the importer root package.

    Contract:
    - importer "." is allowed only from the repo root package (native.package_name() == "" or ".")
    - importer "apps/<x>" or "libs/<x>" is allowed only from that exact package
    """
    if importer == None or not isinstance(importer, str) or importer == "":
        return

    pkg = native.package_name()
    pkg_norm = "." if (pkg == "" or pkg == ".") else pkg
    imp_norm = "." if importer == "." else importer

    if imp_norm == ".":
        if pkg_norm == ".":
            return
        fail(
            (
                "%s. Current package: '%s'. Importer: '%s'. "
                + "Move this target to the importer package (repo root for importer '.') so importer-local patches can be globbed as real action inputs."
            )
            % (_ERROR_PREFIX, pkg_norm, imp_norm)
        )

    if pkg_norm == imp_norm:
        return

    fail(
        (
            "%s. Current package: '%s'. Importer: '%s'. "
            + "Move this target to //%s:<name> (or switch this target to package-local patching) so patch edits invalidate deterministically."
        )
        % (_ERROR_PREFIX, pkg_norm, imp_norm, imp_norm)
    )


