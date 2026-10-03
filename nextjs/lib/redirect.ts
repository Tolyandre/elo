// Full-page navigation away from the SPA — the login entry point is a backend
// URL, not an app route. Extracted so tests can observe the call.
export function redirectTo(url: string): void {
    window.location.assign(url);
}
