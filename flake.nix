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
          default = pkgs.callPackage ./nix/default.nix { inherit buildGoApplication; };
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
        in
        {
          default = import ./shell.nix {
            inherit pkgs;
            gomod2nix = gomod2nix.packages.${system}.default;
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
