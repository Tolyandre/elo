{ pkgs ? import <nixpkgs> { } }:

import (pkgs.path + "/nixos/lib/eval-config.nix") {
  system = "x86_64-linux";
  modules = [
    ./elo-web-service-module.nix
    {
      services.elo-web-service.enable = true;
      # Dummy package — only module evaluation is checked here, not the binary.
      _module.args.elo-web-service-pkg = pkgs.hello;
    }
  ];
}
