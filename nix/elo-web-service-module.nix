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

    address = lib.mkOption {
      type = lib.types.str;
      default = "localhost:8080";
      description = "Interface and port to listen to";
    };

    google-service-account-key = lib.mkOption {
      type = lib.types.path;
      description = "Path to the Google service account key file. This file is sensitive";
    };

    doc-id = lib.mkOption {
      type = lib.types.str;
      description = "Google sheets document ID (identifier after /d/ in the document url)";
    };
  };

  config = lib.mkIf config.services.elo-web-service.enable {
    systemd.services.elo-web-service = {
      description = "Elo web service";
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        Environment = "GOOGLE_SERVICE_ACCOUNT_KEY=%d/google-service-account-key";
        ExecStart = "${elo-web-service}/bin/elo-web-service --config-path /etc/elo-web-service/config.yaml";
        Restart = "always";
        WorkingDirectory = "/var/lib/elo-web-service";
        User = "elo-web-service";
        Group = "elo-web-service";
        StateDirectory = "elo-web-service";
        LoadCredential = [
          "google-service-account-key:${config.services.elo-web-service.google-service-account-key}"
        ];
      };
    };

    environment.etc."elo-web-service/config.yaml".text = ''
      doc_id: "${toString config.services.elo-web-service.doc-id}"
      address: "${toString config.services.elo-web-service.address}"'';

    users.users.elo-web-service = {
      isSystemUser = true;
      home = "/var/lib/elo-web-service";
      createHome = true;
      group = "elo-web-service";
    };

    users.groups.elo-web-service = { };
  };
}
