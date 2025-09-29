{ pkgs ? import <nixpkgs> {} }:

pkgs.buildGoModule {
  pname = "elo-web-service";
  version = "0.1.0";

  src = ../elo-web-service;

  # vendorHash is for dependencies
  # `nix-build` shows it on first run
  vendorHash = "sha256-2BZVOsQ4R9RMLoCQIfQecDj90fP1zkT5efyDgJXXw5E=";
}
