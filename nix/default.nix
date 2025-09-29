{ pkgs ? import <nixpkgs> {} }:

pkgs.buildGoModule {
  pname = "elo-web-service";
  version = "0.1.0";

  src = ../elo-web-service;

  # vendorHash is for dependencies
  # `nix-build` shows it on first run
  vendorHash = "sha256-yEZX4Yh+UqryaFnqp5vwDd7A1utk1+5z2tPs0J39uaQ=";
}
