# elo
Track friends elo rating in board games

Demo https://tolyandre.github.io/elo/


## Building web

- Web application with nextjs. Hosted on GitHub pages. See [readme](./nextjs/README.md).

## Building backend

```bash
cd elo-web-service
go run google-sheet-elo.go main.go --google-service-account-key ../google-service-account-key.json
```