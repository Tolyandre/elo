{
  pkgs ? import <nixpkgs> { },
}:

pkgs.testers.nixosTest {
  name = "elo-web-service-test";

  nodes.machine =
    { config, pkgs, ... }:
    {
      imports = [ ./elo-web-service-module.nix ];

      services.elo-web-service = {
        enable = true;

        config = {
          address = "localhost:4949";
          doc_id = "dummy-document-id";
          oauth2_auth_uri = "https://fake/oauth2_auth_uri";
          oauth2_redirect_uri = "https://fake/oauth2_redirect_uri";
          oauth2_token_uri = "https://fake/oauth2_token_uri";
          frontend_uri = "https://tolyandre.github.io/elo";
          cookie_ttl_seconds = 600;
          postgres = {
            enableLocalDatabase = true;
          };
        };

        google-service-account-key = pkgs.writeText "google-service-account-key.json" ''
          {
            "type": "service_account",
            "project_id": "elo-project-466111",
            "private_key_id": "1111111",
            "private_key": "1111111",
            "client_email": "elo-web-service@elo-project-111111.iam.gserviceaccount.com",
            "client_id": "1111111111111111111111111",
            "auth_uri": "https://fake",
            "token_uri": "https://fake",
            "auth_provider_x509_cert_url": "fake",
            "client_x509_cert_url": "https://www.googleapis.com/",
            "universe_domain": "googleapis.com"
          }
        '';

        secrets-env-file = pkgs.writeText "secrets.env" ''
          ELO_WEB_SERVICE_OAUTH2_CLIENT_ID=1111111111111111111111111
          ELO_WEB_SERVICE_OAUTH2_CLIENT_SECRET=2222
          ELO_WEB_SERVICE_COOKIE_JWT_SECRET=3333
        '';
      };
    };

  testScript = ''
    start_all()
    machine.wait_for_unit("elo-web-service-db-setup.service")
    machine.succeed("sudo -u elo-web-service psql -d elo-web-service -c 'select 1'")
    machine.wait_for_unit("elo-web-service.service")
    machine.wait_for_open_port(4949)
    machine.succeed("curl -s http://localhost:4949/ping | grep -i pong")
  '';
}
