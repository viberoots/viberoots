{ lib }:
let
  numeric = value:
    let parsed = builtins.match "^(0|[1-9][0-9]*)$" value;
    in if parsed == null then builtins.throw "invalid Cargo semver component: ${value}"
       else lib.toInt value;
  parseVersion = value:
    let
      match = builtins.match
        "^([0-9]+)\\.([0-9]+)\\.([0-9]+)(-([0-9A-Za-z.-]+))?(\\+[0-9A-Za-z.-]+)?$"
        value;
    in if match == null then builtins.throw "invalid Cargo package version: ${value}"
       else {
         major = numeric (builtins.elemAt match 0);
         minor = numeric (builtins.elemAt match 1);
         patch = numeric (builtins.elemAt match 2);
         pre = builtins.elemAt match 4;
         text = value;
       };
  parseComparator = raw:
    let
      value = lib.removePrefix " " (lib.removeSuffix " " raw);
      match = builtins.match
        "^(\\^|~|>=|<=|>|<|=)?[ ]*([0-9]+|[xX*])(\\.([0-9]+|[xX*]))?(\\.([0-9]+|[xX*]))?(-([0-9A-Za-z.-]+))?$"
        value;
      op = if match == null || builtins.elemAt match 0 == null
        then "^" else builtins.elemAt match 0;
      part = index:
        let component = builtins.elemAt match index;
        in if component == null || builtins.elem component [ "x" "X" "*" ]
           then null else numeric component;
    in if match == null then builtins.throw "unsupported Cargo version requirement: ${raw}"
       else {
         inherit op;
         wildcard = builtins.match ".*[xX*].*" value != null;
         major = part 1;
         minor = part 3;
         patch = part 5;
         pre = builtins.elemAt match 7;
       };
  core = comparator: [
    (if comparator.major == null then 0 else comparator.major)
    (if comparator.minor == null then 0 else comparator.minor)
    (if comparator.patch == null then 0 else comparator.patch)
  ];
  compareCore = left: right:
    if builtins.elemAt left 0 != builtins.elemAt right 0
    then if builtins.elemAt left 0 < builtins.elemAt right 0 then -1 else 1
    else if builtins.elemAt left 1 != builtins.elemAt right 1
    then if builtins.elemAt left 1 < builtins.elemAt right 1 then -1 else 1
    else if builtins.elemAt left 2 != builtins.elemAt right 2
    then if builtins.elemAt left 2 < builtins.elemAt right 2 then -1 else 1
    else 0;
  versionCore = version: [ version.major version.minor version.patch ];
  lowerText = comparator:
    let values = core comparator;
    in "${toString (builtins.elemAt values 0)}.${toString (builtins.elemAt values 1)}.${toString (builtins.elemAt values 2)}"
      + lib.optionalString (comparator.pre != null) "-${comparator.pre}";
  fullCompare = version: comparator:
    builtins.compareVersions version.text (lowerText comparator);
  specifiedCompare = version: comparator:
    if version.major != comparator.major
    then if version.major < comparator.major then -1 else 1
    else if comparator.minor == null then 0
    else if version.minor != comparator.minor
    then if version.minor < comparator.minor then -1 else 1
    else if comparator.patch == null then 0
    else fullCompare version comparator;
  upperCore = comparator:
    let values = core comparator;
        major = builtins.elemAt values 0;
        minor = builtins.elemAt values 1;
        patch = builtins.elemAt values 2;
    in if comparator.op == "~"
       then if comparator.minor == null then [ (major + 1) 0 0 ] else [ major (minor + 1) 0 ]
       else if major > 0 then [ (major + 1) 0 0 ]
       else if comparator.minor == null then [ 1 0 0 ]
       else if minor > 0 then [ 0 (minor + 1) 0 ]
       else if comparator.patch == null then [ 0 1 0 ]
       else [ 0 0 (patch + 1) ];
  wildcardMatch = version: comparator:
    (comparator.major == null || version.major == comparator.major)
    && (comparator.minor == null || version.minor == comparator.minor)
    && (comparator.patch == null || version.patch == comparator.patch);
  matchesComparator = version: comparator:
    let
      compared = compareCore (versionCore version) (core comparator);
      wildcard = comparator.major == null || comparator.minor == null || comparator.patch == null;
    in if comparator.op == "=" then wildcardMatch version comparator
       else if comparator.op == ">" then specifiedCompare version comparator > 0
       else if comparator.op == ">=" then fullCompare version comparator >= 0
       else if comparator.op == "<" then specifiedCompare version comparator < 0
       else if comparator.op == "<=" then specifiedCompare version comparator <= 0
       else if comparator.wildcard
       then wildcardMatch version comparator
       else compared >= 0 && compareCore (versionCore version) (upperCore comparator) < 0;
  prereleaseAllowed = version: comparators:
    version.pre == null || builtins.any
      (comparator:
        comparator.pre != null
        && compareCore (versionCore version) (core comparator) == 0)
      comparators;
in {
  versionCompatible = requirement: value:
    let
      version = parseVersion value;
      normalized = if requirement == "" then "*" else requirement;
      comparators = map parseComparator (lib.splitString "," normalized);
    in prereleaseAllowed version comparators
      && builtins.all (matchesComparator version) comparators;
}
