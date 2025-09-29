{ pkgs ? import <nixpkgs> {} }:

import (pkgs.path + "/nixos/lib/eval-config.nix") {
  system = "x86_64-linux";
  modules = [
    ./elo-web-service-module.nix
    { services.elo-web-service.enable = true; }
  ];
}
