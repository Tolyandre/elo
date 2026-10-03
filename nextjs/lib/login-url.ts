// The login entry point and the mirror identity of this build.
//
// The login carries "from" — the mirror the user started on — through Google
// OAuth as "state"; the backend validates it against its allowed_frontend_uris
// and redirects back to it after the callback, so every deployment mirror
// keeps its own users.

import { EloWebServiceBaseUrl } from "@/app/api";

// The mirror this build is served from: origin plus the baked basePath.
export function currentFrontendUri(): string {
    return window.location.origin + (process.env.NEXT_PUBLIC_BASE_PATH ?? "");
}

// The backend login entry point carrying the mirror to return to. Callers
// must navigate to it client-side (click handler), so "from" reflects the
// actual origin even on a statically prerendered page.
export function loginUrl(): string {
    return `${EloWebServiceBaseUrl}/auth/login?from=${encodeURIComponent(currentFrontendUri())}`;
}
