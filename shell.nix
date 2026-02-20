# https://github.com/nix-community/nix-direnv?tab=readme-ov-file#usage-example
# don't foget to run `direnv allow`

{ pkgs ? import <nixpkgs> { } }:
let
  lib = pkgs.lib;
in
pkgs.mkShell {
  hardeningDisable = [ "fortify" ];

  buildInputs = lib.optionals pkgs.stdenv.isLinux [ pkgs.libcap pkgs.glibc.static ] ++ [
    pkgs.git # fix xcrun for mac (tool 'git' not found)
    pkgs.go
    pkgs.gcc
    pkgs.sqlc
  ];
}