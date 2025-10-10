# Environment configuration for this Next.js app

This folder contains environment configuration files and guidance for local development and CI builds.

Files added
- `.env.development.local` — variables used when running `next dev` locally. Intended for debugging. Do not commit secrets here.
- `.env.production` — variables used at build time (for example, in GitHub Actions) and when running the built app in production. Keep secrets in CI secrets.

Recommended variables
- NODE_ENV — `development` or `production`.
- NEXT_PUBLIC_API_BASE_URL — base URL for the API endpoints the frontend talks to.
- NEXT_PUBLIC_ENABLE_ANALYTICS — whether analytics should be enabled.
- NEXT_PUBLIC_GOOGLE_SHEET_ID — ID for any Google Sheet integration used by the app.
- NEXT_PUBLIC_DEBUG — a debug flag (only for local/dev usage).

Using in GitHub Actions
1. Set repository secrets in GitHub (Settings → Secrets → Actions). Add keys matching the variable names above, e.g. `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_GOOGLE_SHEET_ID`, etc.
2. In your workflow, ensure the secrets are available to the build step. Example snippet:

```yaml
env:
  NODE_ENV: production
  NEXT_PUBLIC_API_BASE_URL: ${{ secrets.NEXT_PUBLIC_API_BASE_URL }}
  NEXT_PUBLIC_GOOGLE_SHEET_ID: ${{ secrets.NEXT_PUBLIC_GOOGLE_SHEET_ID }}
  NEXT_PUBLIC_ENABLE_ANALYTICS: ${{ secrets.NEXT_PUBLIC_ENABLE_ANALYTICS }}
```

Note about runtime vs build-time
- Next.js in the app router uses environment variables prefixed with `NEXT_PUBLIC_` at build time and embeds them into the client bundles. For values you need to change without rebuilding (server-only secrets), keep them as server runtime env vars and do not prefix with `NEXT_PUBLIC_`.

Security
- Never commit secrets to the repository. Use GitHub Secrets or other secure stores and inject them in CI or runtime environments.
