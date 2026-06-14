{ pkgs ? import <nixpkgs> { } }:

import (pkgs.path + "/nixos/lib/eval-config.nix") {
  system = "x86_64-linux";
  modules = [
    ./elo-web-service-module.nix
    {
      services.elo-web-service.instances."elo-web-service" = {
        settings = {
          oauth2_auth_uri = "https://fake/oauth2_auth_uri";
          oauth2_redirect_uri = "https://fake/oauth2_redirect_uri";
          oauth2_token_uri = "https://fake/oauth2_token_uri";
          oauth2_userinfo_uri = "https://fake/oauth2_userinfo_uri";
          frontend_uri = "https://tolyandre.github.io/elo";
        };
        secrets-env-file = "/run/secrets/elo-web-service.env";
      };
      # Dummy package — only module evaluation is checked here, not the binary.
      _module.args.elo-web-service-pkg = pkgs.hello;
    }
  ];
}
