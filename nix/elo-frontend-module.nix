{
  config,
  lib,
  # Provided by the flake's nixosModules.frontend via _module.args. It is the
  # callPackage'd frontend derivation, so `.override` selects per-instance
  # basePath / apiBaseUrl / bannerText / revision.
  elo-frontend-pkg,
  ...
}:

let
  cfg = config.services.elo-frontend;

  instanceModule =
    { name, config, ... }:
    {
      options = {
        package = lib.mkOption {
          type = lib.types.package;
          default = elo-frontend-pkg;
          description = "The frontend package to build this instance from (overridden with the instance's parameters).";
        };

        basePath = lib.mkOption {
          type = lib.types.str;
          example = "/elo";
          description = "URL path prefix the frontend is served under (baked into the static build).";
        };

        apiBaseUrl = lib.mkOption {
          type = lib.types.str;
          example = "https://toly.is-cool.dev/elo-web-service";
          description = "Absolute URL of the elo-web-service backend this frontend talks to (baked in at build time).";
        };

        banner = lib.mkOption {
          type = lib.types.str;
          default = "";
          example = "Тестовый сервер";
          description = "Optional banner label shown at the top of every page. Empty hides the banner.";
        };

        revision = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "Build revision used to version the service-worker precache. Defaults to the package's own revision when null.";
        };

        out = lib.mkOption {
          type = lib.types.package;
          readOnly = true;
          description = "The built static-site directory for this instance (serve it with Caddy/nginx file_server).";
        };
      };

      config.out = config.package.override (
        {
          inherit (config) basePath apiBaseUrl;
          bannerText = config.banner;
        }
        // lib.optionalAttrs (config.revision != null) { inherit (config) revision; }
      );
    };
in
{
  options.services.elo-frontend.instances = lib.mkOption {
    type = lib.types.attrsOf (lib.types.submodule instanceModule);
    default = { };
    description = ''
      Named static-frontend builds. Each instance produces a parameterized
      Next.js static export exposed at `services.elo-frontend.instances.<name>.out`,
      which a web server (e.g. Caddy `file_server`) serves. This module only
      builds the artifacts; routing is configured by the host (so existing
      reverse-proxy / TLS setup is left untouched).
    '';
  };

  # This module contributes no system config of its own — instances are pure
  # build artifacts consumed via the read-only `out` option. Referencing
  # `cfg.instances` here is unnecessary and would force the option tree.
  config = { };
}
