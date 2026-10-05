# Generates the Caddyfile directives for hosting an elo static frontend and
# reverse-proxying its backend behind precise, non-overlapping path matchers.
# Pure text generation — the host keeps ownership of its site block; see the
# README "Hosting (NixOS)" section for the invocation.
{ lib }:
{
  # Prefix for the generated matcher names; must be unique within the site
  # block ("elo-stage" yields @elo-stage-api / @elo-stage-ui).
  name ? "elo"
  # URL path prefix the frontend is served under (must match the build's
  # basePath).
, basePath ? "/elo"
  # URL path prefix the backend API is served under; stripped before proxying.
, apiPath ? "/elo-web-service"
  # host:port of the backend instance, e.g.
  # config.services.elo-web-service.instances.<name>.settings.address.
, backendAddress
  # The static frontend directory, e.g.
  # config.services.elo-frontend.instances.<name>.out.
, frontendRoot
  # When non-empty, the directives are wrapped in a site block introduced by
  # these verbatim Caddy site addresses (e.g. [ "https://elo.example.com" ]).
, siteAddresses ? [ ]
  # Extra Caddyfile directives appended inside the site block.
, extraDirectives ? ""
}:
let
  # Two-space indent, but leave blank lines empty.
  indent = lib.concatMapStringsSep "\n" (
    line: if line == "" then "" else "  " + line
  );

  apiHandle = ''
    @${name}-api path ${apiPath} ${apiPath}/*
    handle @${name}-api {
      uri strip_prefix ${apiPath}
      reverse_proxy http://${backendAddress}
    }
  '';

  # try_files reproduces GitHub Pages' clean-URL behaviour (/players ->
  # players.html), matching the static export's routing (ADR-25).
  uiHandle = ''
    @${name}-ui path ${basePath} ${basePath}/*
    handle @${name}-ui {
      uri strip_prefix ${basePath}
      root * ${frontendRoot}
      try_files {path} {path}.html {path}/index.html /index.html
      file_server
    }
  '';

  directives =
    apiHandle
    + "\n"
    + uiHandle
    + lib.optionalString (extraDirectives != "") "\n${extraDirectives}";
in
if siteAddresses == [ ]
then directives
else ''
  ${lib.concatStringsSep ",\n" siteAddresses} {
  ${indent (lib.splitString "\n" (lib.removeSuffix "\n" directives))}
  }
''
