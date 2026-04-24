# elo

Track friends elo rating in board games. Try it here: https://tolyandre.github.io/elo/

# How to build and run

Development tools are managed via [Nix flakes](https://nix.dev/manual/nix/2.28/quick-start.html) and activated automatically with [direnv](https://direnv.net/) + [nix-direnv](https://github.com/nix-community/nix-direnv).

I am using NixOS to develop and host this project. Mac and other Linux users can install the Nix package manager.

```bash
# Install Nix package manager
curl -L https://nixos.org/nix/install | sh

# Install direnv and nix-direnv (or configure via home-manager / NixOS)
nix profile add nixpkgs#direnv nixpkgs#nix-direnv --extra-experimental-features "flakes nix-command"

# Register direnv shell hook — add to ~/.zshrc or ~/.bashrc:
# eval "$(direnv hook zsh)"

# Enable nix-direnv caching — add to ~/.config/direnv/direnvrc:
# source_url "https://raw.githubusercontent.com/nix-community/nix-direnv/master/direnvrc" "<sha256>"
# (or configure via home-manager: programs.direnv.nix-direnv.enable = true)

# Allow direnv in the repo root
direnv allow
```

nix-direnv is required to avoid a VSCode restart loop: without it direnv re-evaluates the flake on every VSCode start, which triggers another reload prompt indefinitely.

### VSCode setup

Install the [mkhl.direnv](https://marketplace.visualstudio.com/items?itemName=mkhl.direnv) extension. It picks up the flake devShell automatically — no separate Nix extension needed.

The workspace [settings.json](.vscode/settings.json) already sets `python.defaultInterpreterPath` to `.venv/bin/python`, so the Python extension resolves imports correctly once the venv is created (see [Python section](#python-recognition-tools) below).

## Dependencies and fast startup

You can use docker compose to start the database with test data. See [makefile](./Makefile):

```bash
# start dependencies (postgres) in docker compose (including db migrations and test data)
make dev-up

# run elo-web-service
make backend-run

# run nextjs app
make frontend-run

# stop dependencies
make dev-down
```

You can also run the project with vscode, see [launch.json](.vscode/launch.json).

## Google OAuth2

Elo-web-service uses Google OAuth2 to authenticate users.

To setup credentials use [Google Cloud Console](https://console.developers.google.com/). Create a new project or use existing one.

Create a new OAuth 2.0 Client ID for elo-web-service. Setup authorized JavaScript origins (where static html files are hosted, for GitHub pages I use `https://tolyandre.gitbub.com`). Setup Authorized redirect URIs (I use self-hosted server, in my case it is `https://toly.is-cool.dev/elo-web-service/sessions/oauth/google`).

Download client secret and setup environment variables (see [.env.sample](./elo-web-service/.env.sample`))

Edit branding and OAuth consent screen.

Add Data Access scopes: .../auth/userinfo.email, .../auth/userinfo.profile

## Building web (nextjs)

Frontend is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

Run the development server:

```bash
pnpm --dir ./nextjs dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Building backend (Golang)

```bash
cd elo-web-service
go run . --config-path ./config/config.docker.yaml
```

## Python (recognition tools)

Card recognition scripts live in `recognition/` and use Python 3.11. All dependencies (`ultralytics`, `albumentations`, `opencv`, `fastapi`, etc.) are declared in `flake.nix` and provided by the Nix devShell — no `pip install` or venv setup required.

After `direnv allow`, `python3.11` in the shell already has all packages available. VSCode's Python extension picks up the interpreter via `.vscode/settings.json`, which points to `.python-nix/bin/python3.11` — a symlink to the current Nix Python env, recreated automatically by the shellHook on each `direnv reload`.

## Hosting (NixOS)

### Flake (recommended)

```bash
nix build                # build elo-web-service binary
nix develop              # enter dev shell (includes gomod2nix, go, sqlc, dlv)
nix flake check          # evaluate all outputs + run NixOS integration test in VM
nix flake show           # list all flake outputs

nix flake lock           # pin dependencies (commit flake.lock afterwards)
nix flake update         # update all inputs to latest
```

### Updating Go dependencies

After any `go get` / `go mod tidy`, regenerate the dependency lock for Nix:

```bash
cd elo-web-service
go mod tidy
gomod2nix generate        # updates gomod2nix.toml
```

Commit `go.mod`, `go.sum`, and `gomod2nix.toml` together. The Nix build will fail
if `gomod2nix.toml` is out of sync with `go.mod`.

**First-time setup** (if `gomod2nix.toml` doesn't exist yet):
```bash
nix develop               # enter shell — gomod2nix is available here
cd elo-web-service && gomod2nix generate
```

### Legacy (without flake)

Check syntax of nix module:
```bash
cd nix
nix-instantiate --strict test-syntax.nix
```

Run integration test in virtual machine (requires a pre-built package):
```bash
cd nix
nix-build test-integration.nix --arg elo-web-service-pkg "$(nix build --print-out-paths)"
```

### NixOS module deployment

The flake exposes a NixOS module as `nixosModules.default`. Add it to your system flake:

```nix
# flake.nix on the target host
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    elo.url     = "github:tolyandre/elo";
  };

  outputs = { nixpkgs, elo, ... }: {
    nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        elo.nixosModules.default
        ./configuration.nix
      ];
    };
  };
}
```

Configure the service in `configuration.nix`:

```nix
services.elo-web-service = {
  enable = true;

  # File with secrets — must NOT be in the Nix store
  secrets-env-file = "/run/secrets/elo-web-service.env";

  config = {
    address = "localhost:8080";

    oauth2_auth_uri     = "https://accounts.google.com/o/oauth2/v2/auth";
    oauth2_token_uri    = "https://oauth2.googleapis.com/token";
    oauth2_userinfo_uri = "https://www.googleapis.com/oauth2/v3/userinfo";
    oauth2_redirect_uri = "https://example.com/sessions/oauth/google";

    frontend_uri       = "https://example.com";
    cookie_ttl_seconds = 86400;

    postgres.enableLocalDatabase = true;  # provisions a local PostgreSQL instance
  };
};
```

The `secrets-env-file` must contain:

```env
ELO_WEB_SERVICE_OAUTH2_CLIENT_ID=<Google OAuth2 client ID>
ELO_WEB_SERVICE_OAUTH2_CLIENT_SECRET=<Google OAuth2 client secret>
ELO_WEB_SERVICE_COOKIE_JWT_SECRET=<random secret for JWT signing>
```

Store it outside the Nix store (e.g. via [sops-nix](https://github.com/Mic92/sops-nix), [agenix](https://github.com/ryantm/agenix), or a manually provisioned file with restricted permissions).

#### Module options

| Option | Default | Description |
|--------|---------|-------------|
| `config.address` | `"localhost:8080"` | Bind address |
| `config.oauth2_auth_uri` | — | Google OAuth2 auth endpoint |
| `config.oauth2_token_uri` | — | Google OAuth2 token endpoint |
| `config.oauth2_userinfo_uri` | — | Google OAuth2 userinfo endpoint |
| `config.oauth2_redirect_uri` | — | OAuth2 callback URL |
| `config.frontend_uri` | — | Frontend origin (CORS + redirects) |
| `config.cookie_ttl_seconds` | `86400` | Session cookie lifetime |
| `config.postgres.enableLocalDatabase` | `false` | Provision local PostgreSQL |
| `config.postgres.host` | `"/run/postgresql"` | DB host or Unix socket path |
| `config.postgres.port` | `5432` | DB port |
| `config.postgres.user` | `null` (= service name) | DB user |
| `config.postgres.database` | `null` (= service name) | DB name |

## Database (Postgres)

Run following queries in context of a test database.

## Prepare database

Creating a user for testing:

```sql
CREATE ROLE "elo-web-service-test" WITH LOGIN;
GRANT ALL PRIVILEGES ON DATABASE "elo-web-service-test" to "elo-web-service-test";
GRANT ALL ON SCHEMA public TO "elo-web-service-test";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "elo-web-service-test";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "elo-web-service-test";
```

## Apply migrations

```bash
cd elo-web-service
set -a && source .env && set +a && go run . --config-path ./config/config.dev.yaml --migrate-db
```

Or apply migrations using vscode, see [.vscode/launch.json](.vscode/launch.json).

