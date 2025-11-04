{
  config,
  pkgs,
  lib,
  ...
}:

let
  elo-web-service = pkgs.callPackage ./default.nix { };
in
{
  options.services.elo-web-service = {
    enable = lib.mkEnableOption "Elo web service";

    google-service-account-key = lib.mkOption {
      type = lib.types.path;
      description = "Path to the Google service account key file. This file is sensitive";
    };

    secrets-env-file = lib.mkOption {
      type = lib.types.path;
      description = "Path to the secrets.env file containing sensitive environment variables like ELO_WEB_SERVICE_OAUTH2_CLIENT_ID, ELO_WEB_SERVICE_OAUTH2_CLIENT_SECRET, and ELO_WEB_SERVICE_COOKIE_JWT_SECRET";
    };

    # Deprecated individual options removed: use `config` attribute set below to supply values

    config = lib.mkOption {
      type = lib.types.submodule {
        options = {
          doc_id = lib.mkOption {
            type = lib.types.str;
            description = "Google sheets document ID (identifier after /d/ in the document url)";
          };

          address = lib.mkOption {
            type = lib.types.str;
            default = "localhost:8080";
            description = "Bind address for the web service";
          };

          oauth2_auth_uri = lib.mkOption {
            type = lib.types.str;
            description = "OAuth2 initial URI";
          };
          oauth2_redirect_uri = lib.mkOption {
            type = lib.types.str;
            description = "OAuth2 redirect (callback) URI";
          };

          oauth2_token_uri = lib.mkOption {
            type = lib.types.str;
            description = "Oauth2 url to get ID and access token";
          };

          frontend_uri = lib.mkOption {
            type = lib.types.str;
            description = "Frontend URI (used for CORS and redirects)";
          };
        };
      };

      description = "Configuration for elo-web-service (written to /etc/elo-web-service/config.yaml)";
    };
  };

  config = lib.mkIf config.services.elo-web-service.enable {
    systemd.services.elo-web-service = {
      description = "Elo web service";
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        Environment = [
          "ELO_WEB_SERVICE_GOOGLE_SERVICE_ACCOUNT_KEY=%d/google-service-account-key.json"
          "GIN_MODE=release"
        ];
        ExecStart = "${pkgs.bash}/bin/bash -c 'set -a; source \"$CREDENTIALS_DIRECTORY/secrets.env\"; exec ${elo-web-service}/bin/elo-web-service --config-path /etc/elo-web-service/config.yaml'";
        Restart = "always";
        WorkingDirectory = "/var/lib/elo-web-service";
        User = "elo-web-service";
        Group = "elo-web-service";
        StateDirectory = "elo-web-service";
        LoadCredential = [
          "google-service-account-key.json:${config.services.elo-web-service.google-service-account-key}"
          "secrets.env:${config.services.elo-web-service.secrets-env-file}"
        ];
      };
    };

    environment.etc."elo-web-service/config.yaml".text =
      let
        svcConfig = config.services.elo-web-service.config or { };
      in
      lib.generators.toYAML { } svcConfig;

    users.users.elo-web-service = {
      isSystemUser = true;
      home = "/var/lib/elo-web-service";
      createHome = true;
      group = "elo-web-service";
    };

    users.groups.elo-web-service = { };
  };
}
