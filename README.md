# elo

Track friends elo rating in board games. Try it here: https://tolyandre.github.io/elo/

# How to build and run

Use [direnv](https://direnv.net/) with [nix-direnv](https://github.com/nix-community/nix-direnv) and [shell.nix](./shell.nix) to install development tools. 

For vscode direnv works with [Nix Extension Pack](https://marketplace.visualstudio.com/items?itemName=pinage404.nix-extension-pack).

I am using NixOS to develop and host this project. Mac and other Linux users can install Nix package manager. If you not familiar with Nix, I suggest you read documentation first https://nix.dev/manual/nix/2.28/quick-start.html

```bash
# Install Nix package manager
curl -L https://nixos.org/nix/install | sh

# Install direnv in nix profile (you may want install it with nix configuration instead)
nix profile add nixpkgs#direnv --extra-experimental-features flakes --extra-experimental-features nix-command

# You also neeed to register direnv shell hook and restart the shell
# e.g. in case of zsh add to ~/.zshrc 
# eval "$(direnv hook zsh)"

# Run the root of the project
direnv allow
```

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

## Hosting (NixOS)

Check syntax of nix module:
```bash
cd nix
nix-instantiate --strict test-syntax.nix
```

Run integration test in virtual machine:
```bash
nix-build test-integration.nix
```

In case of error `go: inconsistent vendoring in /build/elo-web-service` remove vendorHash value in `default.nix`, then run:
```bash
nix-build
```
Then update vendorHash with a new value from error message.

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

