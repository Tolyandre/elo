{ pkgs ? import <nixpkgs> {} }:

pkgs.buildGoModule {
  pname = "elo-web-service";
  version = "0.1.0";

  src = ../elo-web-service;

  # vendorHash is for dependencies
  # `nix-build` shows it on first run
  vendorHash = "sha256-UKJAvhiiSzWTV+fO8wm9p6DsZD2+YG4LzUPRNKpxN6Q=";
}
