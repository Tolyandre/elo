{
  description = "Elo rating tracker for board games";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    gomod2nix = {
      url = "github:nix-community/gomod2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { self, nixpkgs, gomod2nix }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          inherit (gomod2nix.legacyPackages.${system}) buildGoApplication;
        in
        {
          default = pkgs.callPackage ./nix/default.nix {
              inherit buildGoApplication pkgs;
              version = self.rev or self.dirtyRev;
            };
        }
      );

      # The module receives the pre-built package via _module.args rather than
      # building it independently, so vendorHash is no longer needed in the module.
      nixosModules.default = { pkgs, ... }: {
        imports = [ ./nix/elo-web-service-module.nix ];
        _module.args.elo-web-service-pkg = self.packages.${pkgs.system}.default;
      };

      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          lib = pkgs.lib;
          pythonEnv = pkgs.python3.withPackages (ps: [
            ps.tkinter
            ps.ultralytics
            ps.albumentations
            ps.opencv4
            ps.pillow
            ps.numpy
            ps.fastapi
            ps.uvicorn
            ps.python-multipart
          ]);
        in
        {
          default = pkgs.mkShell {
            hardeningDisable = [ "fortify" ];

            buildInputs =
              lib.optionals pkgs.stdenv.isLinux [
                pkgs.libcap
                pkgs.glibc.static
              ]
              ++ [
                pkgs.git
                pkgs.go
                pkgs.gcc
                pkgs.pkg-config
                pkgs.opencv
                pkgs.sqlc
                pkgs.delve
                pythonEnv
                pkgs.ninja
                pkgs.meson
                pkgs.cmake
                pkgs.zlib
                gomod2nix.packages.${system}.default
              ];

            shellHook = lib.optionalString pkgs.stdenv.isLinux ''
              export LD_LIBRARY_PATH=${lib.makeLibraryPath [
                pkgs.stdenv.cc.cc
                pkgs.zlib
                pkgs.glib
                pkgs.xorg.libxcb
                pkgs.xorg.libX11
                pkgs.xorg.libXext
                pkgs.libGL
                pkgs.libglvnd
              ]}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}

              # Stable symlink so VSCode can locate the Nix Python interpreter.
              # Recreated on every direnv reload when the env changes.
              ln -sfn ${pythonEnv} "$PWD/.python-nix"
            '';
          };
        }
      );

      checks = {
        x86_64-linux.integration = import ./nix/test-integration.nix {
          pkgs = nixpkgs.legacyPackages.x86_64-linux;
          elo-web-service-pkg = self.packages.x86_64-linux.default;
        };
      };
    };
}
