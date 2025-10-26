# elo
Track friends elo rating in board games.

This project is a convinent form for this Google Sheet document https://docs.google.com/spreadsheets/d/1bf6bmd63dvO9xjtnoTGmkcWJJE0NetQRjKkgcQvovQQ

Demo https://tolyandre.github.io/elo/


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



