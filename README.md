# elo
Track friends elo rating in board games.

This project is a convinent form for this Google Sheet document https://docs.google.com/spreadsheets/d/1bf6bmd63dvO9xjtnoTGmkcWJJE0NetQRjKkgcQvovQQ

Demo https://tolyandre.github.io/elo/

## Google OAuth2 and service account

To setup credentials use [Google Cloud Console](https://console.developers.google.com/). Create a new project or use existing one.

This project uses:
- Google Sheets as backend to store games and calculate rating.
- Google OAuth2 authentication

### Service account

This is a service to service integration to access Google Sheets from elo-web-service.

Create a new service account for elo-web-service. Download a service account key as JSON file and save it in a secure place. Set elo-web-service `google_service_account_key` parameter to path of the key file.

Remember, service account key file is sensitive and should be protected with correct permissions.

### OAuth2 client id and secret

Google OAuth2 is used to authenticate user to authorize data editing.

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
go run command-line-flags.go google-sheet-elo.go main.go \
    --google-service-account-key ../google-service-account-key.json \
    --doc-id 1bf6bmd63dvO9xjtnoTGmkcWJJE0NetQRjKkgcQvovQQ \
    --address localhost:42981
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

Creating a user for testing:

```sql
CREATE ROLE "elo-web-service-test" WITH LOGIN;
GRANT ALL PRIVILEGES ON DATABASE "elo-web-service-test" to "elo-web-service-test";
GRANT ALL ON SCHEMA public TO "elo-web-service-test";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "elo-web-service-test";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "elo-web-service-test";

```



