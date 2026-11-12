// Loader for the offline settlement engine (ADR-38): the Go settlement core
// (pkg/settlement, built by `make build-wasm` / nix/wasm.nix) compiled to
// WebAssembly. The browser runs the exact same math as the server, so
// offline-computed ratings cannot drift; the parity gate is the golden
// fixtures suite (__tests__/settlement-wasm.test.ts).
//
// The bridge is one JSON-in/JSON-out function (eloSettlement.replayArena) —
// the boundary types below mirror pkg/settlement's ReplayInput/ReplayOutput.
// Loading is lazy and failure-tolerant: an unavailable module (old cache,
// load error) degrades to "no offline values", the pre-ADR-38 behavior.

import type { Base58ID } from "@/lib/id";

export type WasmReplayMatch = {
    /** Base58 match id. */
    id: string;
    /** RFC3339. */
    date: string;
    /** Base58 player id → score. */
    scores: Record<string, number>;
};

/** A frozen market settlement row (read-only chain input). */
export type WasmFrozenSettlement = {
    id: string;
    player_id: string;
    date: string;
    rating_after: number;
    elo_after: number;
    rating_staked: number;
    rating_earned: number;
    elo_staked: number;
    elo_earned: number;
    league?: string | null;
};

export type WasmEloSettingsEntry = {
    effective_date: string; // RFC3339; "-infinity" must be mapped to a very old date
    k: number;
    d: number;
    starting_elo: number;
    win_reward: number;
    newbie_league_earned_min: number;
    newbie_league_earned_max: number;
    newbie_league_earned_tau: number;
    newbie_league_goal_gap: number;
    elite_league_matches_6m: number;
    elite_league_matches_2m: number;
};

export type WasmReplayInput = {
    /** The arena's raw settings document (JSON value, validated server-side). */
    settings: unknown;
    settings_version: number;
    elo_settings: WasmEloSettingsEntry[];
    matches: WasmReplayMatch[];
    market_settlements: WasmFrozenSettlement[];
    snapshot_times: string[];
};

export type WasmPlayerResult = {
    elo_staked: number;
    elo_earned: number;
    new_elo: number;
    rating_staked: number;
    rating_earned: number;
    new_rating: number;
    league?: string | null;
};

/** Keyed by Base58 match id; players keyed by Base58 player id. */
export type WasmMatchSettlement = {
    match_id: string;
    players: Record<string, WasmPlayerResult>;
};

export type WasmArenaStanding = {
    player_id: string;
    rating: number;
    league?: string | null;
    rank?: number | null;
    matches_count: number;
    first_count: number;
    second_count: number;
    third_count: number;
    fourth_count: number;
    matches_left_for_elite: number;
    wins_needed_for_amateur_lower: number;
    wins_needed_for_amateur_upper: number;
};

export type WasmStandingsAt = {
    time: string;
    players: WasmArenaStanding[];
};

export type WasmReplayOutput = {
    settlements: WasmMatchSettlement[];
    standings: WasmStandingsAt[];
};

export type WasmBridge = {
    replayArena(input: WasmReplayInput): WasmReplayOutput;
};

declare global {
    interface Window {
        Go?: new () => {
            importObject: WebAssembly.Imports;
            run(instance: WebAssembly.Instance): Promise<void>;
        };
    }
    // The wasm bridge the Go entry installs (cmd/settlementwasm).
    var eloSettlement: { replayArena: (inputJson: string) => string } | undefined;
}

let bridgePromise: Promise<WasmBridge | null> | null = null;

function assetUrl(file: string): string {
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    return `${basePath}/wasm/${file}`;
}

function loadWasmExecRuntime(): Promise<void> {
    if (typeof window === "undefined") return Promise.reject(new Error("no window"));
    if (window.Go) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = assetUrl("wasm_exec.js");
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("wasm_exec.js failed to load"));
        document.head.appendChild(script);
    });
}

async function instantiate(): Promise<WasmBridge | null> {
    await loadWasmExecRuntime();
    if (!window.Go || !WebAssembly) return null;
    const go = new window.Go();
    const bytes = await fetch(assetUrl("settlement.wasm")).then((res) => {
        if (!res.ok) throw new Error(`settlement.wasm ${res.status}`);
        return res.arrayBuffer();
    });
    // instantiateStreaming needs the application/wasm MIME type, which not
    // every static host sets; fall back to the buffered form.
    let instance: WebAssembly.Instance;
    try {
        const { instance: inst } = await WebAssembly.instantiateStreaming(fetch(assetUrl("settlement.wasm")), go.importObject);
        instance = inst;
    } catch {
        ({ instance } = await WebAssembly.instantiate(bytes, go.importObject));
    }
    void go.run(instance);
    const exposed = globalThis.eloSettlement;
    if (!exposed) return null;
    return {
        replayArena(input: WasmReplayInput): WasmReplayOutput {
            const out = exposed.replayArena(JSON.stringify(input));
            const parsed = JSON.parse(out) as WasmReplayOutput & { error?: string };
            if (parsed.error) throw new Error(`settlement replay failed: ${parsed.error}`);
            return parsed;
        },
    };
}

/**
 * Loads the settlement bridge once per page; resolves null when the module
 * cannot be loaded or run (the engine degrades, the UI hides local values).
 */
export function loadSettlementWasm(): Promise<WasmBridge | null> {
    if (!bridgePromise) {
        bridgePromise = instantiate().catch((err) => {
            console.error("settlement wasm unavailable", err);
            return null;
        });
    }
    return bridgePromise;
}

/** Base58 id helper re-export for the engine's imports (no behavior). */
export type { Base58ID };
