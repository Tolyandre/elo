{ pkgs, lib, config, inputs, ... }:

{
  # The service is pure Go (CGO_ENABLED=0, see nix/default.nix). The old flake
  # devShell exported this via the nixpkgs Go setup hook; devenv only puts
  # packages on PATH, so set it explicitly. Without it `go test ./...` compiles
  # runtime/cgo and fails to link against the static glibc in this shell.
  env.CGO_ENABLED = "0";

  # https://devenv.sh/packages/
  packages =
    lib.optionals pkgs.stdenv.isLinux [
      pkgs.libcap
      pkgs.glibc.static
    ]
    ++ [
      pkgs.git
      pkgs.go
      pkgs.sqlc
      pkgs.delve
      pkgs.gopls
      inputs.gomod2nix.packages.${pkgs.system}.default
    ];

  # https://devenv.sh/tests/
  # `devenv test` runs the backend unit suite (includes the openapilint test).
  # Integration tests stay separate: `make integration-test-podman` / `-colima`.
  #
  # Defined as an explicit task `exec` rather than the `enterTest` string
  # option: as of devenv CLI 2.1.2 the built-in devenv:enterTest task is
  # dispatched with no command (the CLI-side script injection is broken), so
  # an `enterTest` string would silently run nothing. Wiring the exec directly
  # works on the generic task runner of every devenv version.
  tasks."devenv:enterTest".exec = "go test -C elo-web-service ./...";

  # Stable, project-relative symlinks so VSCode's Go extension can locate the
  # Nix-provided dlv/gopls without hardcoding /nix/store paths that go stale
  # on every tool update (see .vscode/settings.json go.alternateTools).
  # Recreated on every shell entry, always tracking the pinned tool versions.
  enterShell = ''
    mkdir -p "${config.devenv.root}/.nix-tools"
    ln -sfn ${pkgs.delve} "${config.devenv.root}/.nix-tools/delve"
    ln -sfn ${pkgs.gopls} "${config.devenv.root}/.nix-tools/gopls"
  '';

  # See full reference at https://devenv.sh/reference/options/
}
