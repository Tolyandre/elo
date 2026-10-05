// Global Vitest setup (wired in vitest.config.ts).
//
// React warns when state updates happen outside act(); setting this flag once
// here means individual test files no longer need the per-file snippet.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
