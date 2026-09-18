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
      pkgs.python3
      pkgs.sqlc
      pkgs.delve
      pkgs.gopls
      inputs.gomod2nix.packages.${pkgs.system}.default
    ];

  # https://devenv.sh/tests/
  # `devenv test` runs the backend unit suite (includes the openapilint test)
  # plus a gofmt gate, so formatting is enforced once at the end of a piece of
  # work instead of racing editors mid-stream. Integration tests stay
  # separate: `make integration-test-podman` / `-colima`.
  #
  # `./dev` sets ELO_SKIP_SHELL_TESTS=1 (except for `./dev test`): the suite
  # would otherwise re-run on every shell command, which is noise when the
  # wrapped command's own output is the point. Run `devenv test` for the gate.
  #
  # Defined as an explicit task `exec` rather than the `enterTest` string
  # option: as of devenv CLI 2.1.2 the built-in devenv:enterTest task is
  # dispatched with no command (the CLI-side script injection is broken), so
  # an `enterTest` string would silently run nothing. Wiring the exec directly
  # works on the generic task runner of every devenv version.
  tasks."devenv:enterTest".exec = ''
    if [ "''${ELO_SKIP_SHELL_TESTS:-0}" = "1" ]; then
      echo "devenv:enterTest: skipped (ELO_SKIP_SHELL_TESTS=1 — run 'devenv test' for the suite)"
      exit 0
    fi
    unformatted="$(gofmt -l elo-web-service/main.go elo-web-service/cmd elo-web-service/pkg elo-web-service/integration_test)"
    if [ -n "$unformatted" ]; then
      echo "gofmt gate: unformatted Go files (run gofmt -w on them):"
      echo "$unformatted"
      exit 1
    fi
    go test -C elo-web-service ./...
  '';

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
