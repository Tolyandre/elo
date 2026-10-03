# OAuth login: per-mirror callback, exchange via the API

## Problem

The app is served from several mirrors (the domain deployment and the GitHub
Pages copy) against one backend. After login the user must stay on the mirror
they started from, the mirrors must work independently, and login must not
depend on any frontend being served on the API's own domain.

Two candidate placements of Google's `redirect_uri` were tried:

- **The API's own callback route**, which completed login and `302`'d the
  browser to the mirror. Rejected: with Firefox Enhanced Tracking Protection
  (Total Cookie Protection) the cookie set while passing through the API's
  domain lands in the API-side cookie jar, while the mirror's later XHR reads
  the mirror-side jar — on GitHub Pages the session never materialized.
  Partitioning aside, the Google consent dialog showed the API's domain,
  confusing users.
- **The pre-2026-10 shape**: Google lands on a frontend `/oauth2-callback`
  page, which exchanges the code with the API over XHR. The cookie is set in
  the mirror's own context — exactly the jar the mirror's subsequent requests
  read — which is why it worked in Firefox and broke only in browsers that
  block third-party cookies outright (Opera), where the app shows a targeted
  warning with a retry.

## Decision

The pre-2026-10 shape is restored, with the mirror plumbing made explicit and
multi-mirror safe:

- `frontend_uri` and `allowed_frontend_uris` are the deployment's mirrors
  (base URIs). The Google `redirect_uri` is derived per mirror as
  `<mirror>/oauth2-callback` — the fixed route of the frontend callback page —
  there is no `oauth2_redirect_uri` setting anymore. Every mirror's callback
  URL must be registered in the Google OAuth client.
- `/auth/login` takes `from` (the mirror the login buttons add), validates it
  against the allowlist, sends the user to Google with
  `redirect_uri=<from>/oauth2-callback` and `state=<from>`. Without `from` it
  defaults to `frontend_uri`.
- `GET /auth/oauth2-callback` (JSON API, called by the callback page with
  `credentials: include`) exchanges the code presenting the redirect_uri of
  the mirror in `state` — Google requires the exact match with the
  authorization request. An untrusted or missing state falls back to the
  primary mirror, which simply fails the exchange for a forged pair. On
  success it sets the session cookie.
- The callback page stays on its mirror: it verifies the session (`/auth/me`),
  routes first-time users to `/settings?link-player=1`, and on a definitively
  dropped cookie (definitive 401) shows the cross-domain warning with a retry.

## Consequences

- Mirrors are fully independent: each keeps its users, and the browser
  spends the whole flow on the user's own mirror; the consent dialog shows
  the mirror's domain.
- The cookie is set in the mirror's jar, which Total Cookie Protection
  honors; browsers that block third-party cookie setting outright degrade to
  the explicit warning instead of a silent loop.
- The mirror list is the single source of truth for Google registration:
  one entry ⇔ one registered `<mirror>/oauth2-callback`; the API domain
  itself needs no frontend and no registration.
- The backend carries no frontend routing: the link-player hint is chosen by
  the callback page, not the API.
