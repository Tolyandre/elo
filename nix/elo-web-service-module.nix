{
  config,
  lib,
  # Provided by the flake's nixosModules.default via _module.args.
  # When using the module standalone (e.g. nix-instantiate tests), pass a
  # dummy derivation or override the per-instance `package` option.
  elo-web-service-pkg,
  ...
}:

let
  cfg = config.services.elo-web-service;

  # Options for a single elo-web-service instance. The attribute key under
  # `services.elo-web-service.instances.<name>` is used as the resource base
  # name (systemd unit, system user/group, state directory, config path and the
  # default Postgres database/user), so multiple instances can coexist on one
  # host without colliding.
  instanceModule =
    { ... }:
    {
      options = {
        package = lib.mkOption {
          type = lib.types.package;
          default = elo-web-service-pkg;
          description = "The elo-web-service package (binary) to run for this instance.";
        };

        secrets-env-file = lib.mkOption {
          type = lib.types.path;
          description = "Path to the secrets.env file containing sensitive environment variables like ELO_WEB_SERVICE_OAUTH2_CLIENT_ID, ELO_WEB_SERVICE_OAUTH2_CLIENT_SECRET, and ELO_WEB_SERVICE_COOKIE_JWT_SECRET";
        };

        settings = lib.mkOption {
          type = lib.types.submodule {
            options = {
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

              oauth2_userinfo_uri = lib.mkOption {
                type = lib.types.str;
                description = "OAuth2 userinfo endpoint URI";
              };

              oauth2_scopes = lib.mkOption {
                type = lib.types.str;
                default = "openid profile";
                description = "Space-separated OAuth2 scopes to request during login";
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

              cookie_name = lib.mkOption {
                type = lib.types.str;
                default = "elo-web-service-token";
                description = "Name of the authentication cookie. Override per environment so multiple instances sharing a host do not clobber each other's session cookie.";
              };

              ollama = lib.mkOption {
                type = lib.types.submodule {
                  options = {
                    # Ollama must be installed and running separately on the host.
                    # Standard setup: add `services.ollama.enable = true;` to your NixOS config.
                    # The service should be accessible at baseUrl before elo-web-service starts.
                    baseUrl = lib.mkOption {
                      type = lib.types.str;
                      default = "http://127.0.0.1:11434";
                      description = "Ollama API base URL (used by elo-web-service to call /api/generate)";
                    };

                    # The model must be available in Ollama before use.
                    # Pull it manually: ollama pull llama3.1:8b
                    # qwen2.5 also works well for Russian + JSON mode.
                    model = lib.mkOption {
                      type = lib.types.str;
                      default = "llama3.1:8b";
                      description = "Ollama model name for voice parsing. Must be pulled before use.";
                    };

                    visionModel = lib.mkOption {
                      type = lib.types.str;
                      default = "llava";
                      description = "Ollama model name for card image recognition. Must be pulled before use.";
                    };

                  };
                };
                default = { };
                description = "Ollama settings for voice input NLP parsing and card image recognition";
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
                      description = "Postgres user (optional). Defaults to the instance name. User is not used with Unix socket / peer authentication";
                    };

                    password = lib.mkOption {
                      type = lib.types.nullOr lib.types.str;
                      default = null;
                      description = "Postgres password (optional). Password is not used with Unix socket / peer authentication. This value is sensitive";
                    };

                    database = lib.mkOption {
                      type = lib.types.nullOr lib.types.str;
                      default = null;
                      description = "Postgres database name (optional). Defaults to the instance name";
                    };
                  };
                };
                default = { };
                description = "Postgres connection settings (written to /etc/<instance>/config.yaml)";
              };
            };
          };

          description = "Configuration for this elo-web-service instance (written to /etc/<instance>/config.yaml)";
        };
      };
    };

  # Derive everything needed for one instance. The per-instance pieces are then
  # distributed across STATIC top-level config keys (systemd/environment/users/
  # services) below. The `config` attribute itself must not be `mkMerge` over
  # `instances`, or forcing the config spine would force the instances attrset
  # and re-enter the module fixpoint (infinite recursion via _module.freeformType).
  mkInstance =
    name: icfg:
    let
      pgHost = icfg.settings.postgres.host;
      pgPort = toString icfg.settings.postgres.port;
      pgDatabase = if icfg.settings.postgres.database == null then name else icfg.settings.postgres.database;
      pgUser = if icfg.settings.postgres.user == null then name else icfg.settings.postgres.user;
      pgPassword = icfg.settings.postgres.password;
      pgDsn =
        let
          isSocket = lib.hasPrefix "/" pgHost;
        in
        if isSocket then
          "postgres:///${pgDatabase}?host=${pgHost}&port=${pgPort}"
        else
          "postgres://${pgUser}@${pgHost}:${pgPort}/${pgDatabase}";
      pgPasswordEnv = lib.optional (pgPassword != null) "ELO_WEB_SERVICE_POSTGRES_PASSWORD=${pgPassword}";
    in
    {
      inherit pgDatabase pgUser;
      enableDb = icfg.settings.postgres.enableLocalDatabase;

      service = {
        description = "Elo web service (${name})";
        wantedBy = [ "multi-user.target" ];
        serviceConfig = {
          Environment = [
            "GIN_MODE=release"
            "ELO_WEB_SERVICE_POSTGRES_DSN=${pgDsn}"
            "ELO_WEB_SERVICE_OLLAMA_BASE_URL=${icfg.settings.ollama.baseUrl}"
            "ELO_WEB_SERVICE_OLLAMA_MODEL=${icfg.settings.ollama.model}"
            "ELO_WEB_SERVICE_OLLAMA_VISION_MODEL=${icfg.settings.ollama.visionModel}"
          ]
          ++ pgPasswordEnv;
          EnvironmentFile = icfg.secrets-env-file;
          ExecStart = "${icfg.package}/bin/elo-web-service --config-path /etc/${name}/config.yaml";
          Restart = "always";
          WorkingDirectory = "/var/lib/${name}";
          User = name;
          Group = name;
          StateDirectory = name;
          # journald prefix; otherwise every instance logs as the binary
          # basename "elo-web-service" and they're indistinguishable.
          SyslogIdentifier = name;
        };

        requires = lib.optionals icfg.settings.postgres.enableLocalDatabase [
          "postgresql.service"
          "${name}-db-setup.service"
        ];
        after = lib.optionals icfg.settings.postgres.enableLocalDatabase [
          "postgresql.service"
          "${name}-db-setup.service"
        ];
      };

      dbSetup = {
        description = "Run elo-web-service migrations (${name})";
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
          User = name;
          EnvironmentFile = icfg.secrets-env-file;
          Environment = [ "ELO_WEB_SERVICE_POSTGRES_DSN=${pgDsn}" ] ++ pgPasswordEnv;
          ExecStart = "${icfg.package}/bin/elo-web-service --config-path /etc/${name}/config.yaml --migrate-db";
          SyslogIdentifier = "${name}-db-setup";
        };
      };

      etcText = lib.generators.toYAML { } icfg.settings;

      user = {
        isSystemUser = true;
        home = "/var/lib/${name}";
        createHome = true;
        group = name;
      };
    };

  # Forced lazily (only when one of the static config attributes below is
  # demanded), so the config spine stays independent of `instances`.
  instances = lib.mapAttrs mkInstance cfg.instances;
in
{
  options.services.elo-web-service.instances = lib.mkOption {
    type = lib.types.attrsOf (lib.types.submodule instanceModule);
    default = { };
    description = ''
      Named elo-web-service instances. Each attribute key is used as the
      resource base name for that instance (systemd unit, system user/group,
      state directory, config file path and the default Postgres database/user),
      allowing several instances (e.g. production and stage) to run on one host.
    '';
  };

  config = {
    systemd.services = lib.mkMerge (
      lib.mapAttrsToList (
        name: i:
        { ${name} = i.service; }
        // lib.optionalAttrs i.enableDb { "${name}-db-setup" = i.dbSetup; }
      ) instances
    );

    environment.etc = lib.mkMerge (
      lib.mapAttrsToList (name: i: { "${name}/config.yaml".text = i.etcText; }) instances
    );

    users.users = lib.mkMerge (lib.mapAttrsToList (name: i: { ${name} = i.user; }) instances);
    users.groups = lib.mkMerge (lib.mapAttrsToList (name: _i: { ${name} = { }; }) instances);

    services.postgresql = lib.mkMerge (
      lib.mapAttrsToList (
        name: i:
        lib.mkIf i.enableDb {
          enable = true;
          ensureDatabases = [ i.pgDatabase ];
          ensureUsers = [
            {
              name = i.pgUser;
              ensureDBOwnership = true;
            }
          ];
          authentication = lib.mkBefore ''
            # ${name}
            local ${i.pgDatabase} ${i.pgUser} peer
          '';
        }
      ) instances
    );
  };
}
