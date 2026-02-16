# https://github.com/nix-community/nix-direnv?tab=readme-ov-file#usage-example
# don't foget to run `direnv allow`

{
  pkgs ? import <nixpkgs> { },
}:

pkgs.mkShell {
  hardeningDisable = [ "fortify" ];
  
  buildInputs = [
    pkgs.libcap
    pkgs.glibc.static
    pkgs.go
    pkgs.gcc
    pkgs.sqlc
  ];
}
