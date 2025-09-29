{ config, pkgs, lib, ... }:

let
  elo-web-service = pkgs.callPackage ./default.nix {};
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
        ExecStart = "${elo-web-service}/bin/elo-web-service --address ${toString config.services.elo-web-service.address} --google-service-account-key %d/google-service-account-key --doc-id ${toString config.services.elo-web-service.doc-id}";
        Restart = "always";
        WorkingDirectory = "/var/lib/elo-web-service";
        User = "elo-web-service";
        Group = "elo-web-service";
        LoadCredential = ["google-service-account-key:${config.services.elo-web-service.google-service-account-key}"];
      };
    };

    users.users.elo-web-service = {
      isSystemUser = true;
      home = "/var/lib/elo-web-service";
      createHome = true;
      group = "elo-web-service";
    };

    users.groups.elo-web-service = {};
  };
}
