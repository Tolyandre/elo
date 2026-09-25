"use client";

import { installRootRscPayloadRewrite } from "@/lib/root-rsc-payload";

// Module scope, not an effect: the rewrite must be active before the router
// can issue its first payload request, which any user interaction could
// trigger as soon as click handlers attach.
if (typeof window !== "undefined") installRootRscPayloadRewrite();

/** Renders nothing; importing this client component installs the fetch rewrite (lib/root-rsc-payload.ts). */
export function RootRscPayloadRewrite() {
    return null;
}
