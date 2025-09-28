# elo
Track friends elo rating in board games

Demo https://tolyandre.github.io/elo/


## Building web

- Web application with nextjs. Hosted on GitHub pages. See [readme](./nextjs/README.md).

## Building backend

```bash
cd elo-web-service
go run *.go \
    --google-service-account-key ../google-service-account-key.json \
    --doc-id 1bf6bmd63dvO9xjtnoTGmkcWJJE0NetQRjKkgcQvovQQ \
    --bind-address localhost:42981
```