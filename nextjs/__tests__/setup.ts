// Global Vitest setup (wired in vitest.config.ts).
//
// React warns when state updates happen outside act(); setting this flag once
// here means individual test files no longer need the per-file snippet.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The API client throws at import time without a base URL; suites that never
// touch the network still transitively import it (e.g. the offline ratings
// modules, ADR-38). A default stands in — no test makes real requests.
process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL ??= "http://api.test";
