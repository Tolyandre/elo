{
  description = "Elo rating tracker for board games";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
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

          # Static Next.js export. The default parameters target the GitHub Pages
          # deployment (basePath "/elo", prod backend); override basePath /
          # apiBaseUrl / bannerText for other installs (e.g. stage).
          frontend = pkgs.callPackage ./nix/frontend.nix {
            apiBaseUrl = "https://toly.is-cool.dev/elo-web-service";
            basePath = "/elo";
            revision = self.rev or self.dirtyRev or "dev";
          };
        }
      );

      # The modules receive their pre-built packages via _module.args rather than
      # building them independently, so vendorHash is no longer needed.
      nixosModules.default = { pkgs, ... }: {
        imports = [ ./nix/elo-web-service-module.nix ];
        _module.args.elo-web-service-pkg = self.packages.${pkgs.system}.default;
      };

      # Multi-instance static frontend builder. Import alongside the default
      # (backend) module; instances select their build via `package`.
      nixosModules.frontend = { pkgs, ... }: {
        imports = [ ./nix/elo-frontend-module.nix ];
        _module.args.elo-frontend-pkg = self.packages.${pkgs.system}.frontend;
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
                pkgs.gopls
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
                pkgs.libxcb
                pkgs.libx11
                pkgs.libxext
                pkgs.libGL
                pkgs.libglvnd
              ]}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}

              # Stable symlinks so VSCode can locate Nix-provided tools.
              # Recreated on every direnv reload when the env changes.
              ln -sfn ${pythonEnv} "$PWD/.python-nix"
              ln -sfn ${pkgs.delve} "$PWD/.delve-nix"
              ln -sfn ${pkgs.gopls} "$PWD/.gopls-nix"
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
