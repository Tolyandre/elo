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

          cookie_ttl_seconds = lib.mkOption {
            type = lib.types.int;
            description = "Cookie TTL in seconds";
            default = 86400;
          };

          postgres = lib.mkOption {
            type = lib.types.submodule {
              options = {
                enableLocalDatabase = lib.mkOption {
                  type = lib.types.bool;
                  default = false;
                  description = "Enable a local PostgreSQL service and use it as the default database";
                };

                host = lib.mkOption {
                  type = lib.types.str;
                  default = "/run/postgresql";
                  example = "127.0.0.1";
                  description = "Postgres host. It can be unix socket path";
                };

                port = lib.mkOption {
                  type = lib.types.int;
                  default = 5432;
                  description = "Postgres port";
                };

                user = lib.mkOption {
                  type = lib.types.nullOr lib.types.str;
                  default = null;
                  description = "Postgres user (optional). User is not used with Unix socket / peer authentication";
                };

                password = lib.mkOption {
                  type = lib.types.nullOr lib.types.str;
                  default = null;
                  description = "Postgres password (optional). Password is not used with Unix socket / peer authentication. This value is sensitive";
                };

                database = lib.mkOption {
                  type = lib.types.nullOr lib.types.str;
                  default = null;
                  description = "Postgres database name (optional). Defaults to user name";
                };
              };
            };
            description = "Postgres connection settings (written to /etc/elo-web-service/config.yaml)";
          };
        };
      };

      description = "Configuration for elo-web-service (written to /etc/elo-web-service/config.yaml)";
    };
  };

  config = lib.mkIf config.services.elo-web-service.enable (
    let
      eloWebServiceInstanceName = "elo-web-service";
      pgHost = config.services.elo-web-service.config.postgres.host;
      pgPort = toString config.services.elo-web-service.config.postgres.port;
      pgDatabase =
        if config.services.elo-web-service.config.postgres.database == null then
          eloWebServiceInstanceName
        else
          config.services.elo-web-service.config.postgres.database;
      pgUser =
        if config.services.elo-web-service.config.postgres.user or eloWebServiceInstanceName == null then
          eloWebServiceInstanceName
        else
          config.services.elo-web-service.config.postgres.user;
      pgPassword = config.services.elo-web-service.config.postgres.password;
      pgDsn =
        let
          isSocket = lib.hasPrefix "/" pgHost;
        in
        if isSocket then
          "postgres:///${pgDatabase}?host=${pgHost}&port=${toString pgPort}"
        else
          "postgres://${pgUser}@${pgHost}:${toString pgPort}/${pgDatabase}";
    in
    {

      systemd.services.elo-web-service = {
        description = "Elo web service";
        wantedBy = [ "multi-user.target" ];
        serviceConfig = {
          Environment = (
            [
              "ELO_WEB_SERVICE_GOOGLE_SERVICE_ACCOUNT_KEY=%d/google-service-account-key.json"
              "GIN_MODE=release"
              "ELO_WEB_SERVICE_POSTGRES_DSN=${pgDsn}"
            ]
            ++ lib.optional (pgPassword != null) [ "ELO_WEB_SERVICE_POSTGRES_PASSWORD=${pgPassword}" ]
          );
          EnvironmentFile = config.services.elo-web-service.secrets-env-file;
          ExecStart = "${elo-web-service}/bin/elo-web-service --config-path /etc/elo-web-service/config.yaml";
          Restart = "always";
          WorkingDirectory = "/var/lib/${eloWebServiceInstanceName}";
          User = eloWebServiceInstanceName;
          Group = eloWebServiceInstanceName;
          StateDirectory = eloWebServiceInstanceName;
          LoadCredential = [
            "google-service-account-key.json:${config.services.elo-web-service.google-service-account-key}"
          ];
        };

        requires = (
          if config.services.elo-web-service.config.postgres.enableLocalDatabase then
            [
              "postgresql.service"
              "elo-web-service-db-setup.service"
            ]
          else
            [ ]
        );

        after = (
          if config.services.elo-web-service.config.postgres.enableLocalDatabase then
            [
              "postgresql.service"
              "elo-web-service-db-setup.service"
            ]
          else
            [ ]
        );
      };

      # One-shot service: run migrations when using local DB
      systemd.services.elo-web-service-db-setup =
        lib.mkIf (config.services.elo-web-service.config.postgres.enableLocalDatabase)
          {
            description = "Run elo-web-service migrations";
            wants = [
              "postgresql.service"
              "postgresql-setup.service"
              "postgresql-setup-start.service"
            ];
            after = [
              "postgresql.service"
              "postgresql-setup.service"
              "postgresql-setup-start.service"
            ];
            serviceConfig = {
              Type = "oneshot";
              RemainAfterExit = "yes";
              User = eloWebServiceInstanceName;
              EnvironmentFile = config.services.elo-web-service.secrets-env-file;
              Environment = (
                [
                  "ELO_WEB_SERVICE_GOOGLE_SERVICE_ACCOUNT_KEY=%d/google-service-account-key.json"
                  "ELO_WEB_SERVICE_POSTGRES_DSN=${pgDsn}"
                ]
                ++ lib.optional (pgPassword != null) [ "ELO_WEB_SERVICE_POSTGRES_PASSWORD=${pgPassword}" ]
              );
              LoadCredential = [
                "google-service-account-key.json:${config.services.elo-web-service.google-service-account-key}"
              ];
              ExecStart = "${elo-web-service}/bin/elo-web-service --config-path /etc/elo-web-service/config.yaml --migrate-db";
            };
          };

      services.postgresql = lib.mkIf config.services.elo-web-service.config.postgres.enableLocalDatabase {
        enable = true;
        ensureDatabases = [ pgDatabase ];
        ensureUsers = [
          {
            name = pgUser;
            ensureDBOwnership = true;
          }
        ];
        # TODO: надо?
        authentication = lib.mkBefore ''
          # elo-web-service
          local ${pgDatabase} ${pgUser} peer
        '';
      };

      environment.etc."elo-web-service/config.yaml".text =
        let
          svcConfig = config.services.elo-web-service.config or { };
        in
        lib.generators.toYAML { } svcConfig;

      users.users = lib.mkMerge [
        {
          ${eloWebServiceInstanceName} = {
            isSystemUser = true;
            home = "/var/lib/${eloWebServiceInstanceName}";
            createHome = true;
            group = eloWebServiceInstanceName;
          };
        }
      ];

      users.groups = lib.mkMerge [
        { ${eloWebServiceInstanceName} = { }; }
      ];
    }
  );
}
