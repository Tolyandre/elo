{ pkgs ? import <nixpkgs> {} }:

pkgs.nixosTest {
  name = "elo-web-service-test";

  nodes.machine = { config, pkgs, ... }: {
    imports = [ ./elo-web-service-module.nix ];

    services.elo-web-service = {
      enable = true;
      address = "localhost:4949";
      google-service-account-key = pkgs.writeText "google-service-account-key.json"
      ''
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

      doc-id = "dummy-document-id";
    };
  };

  testScript = ''
    start_all()
    machine.wait_for_unit("elo-web-service.service")
    machine.wait_for_open_port(4949)
    machine.succeed("curl -s http://localhost:4949/ping | grep -i pong")
  '';
}
