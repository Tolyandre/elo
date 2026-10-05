// Elo settings: the effective constants and the admin-managed history.
import { client, unwrap } from "./client";
import type { components } from "../api-types.gen";
import type { EloSettingEntry } from "./types";

export async function getSettingsPromise(): Promise<components["schemas"]["Settings"]> {
    return (await unwrap(client.GET("/settings"))).data;
}

export async function listAllSettingsPromise(): Promise<EloSettingEntry[]> {
    return (await unwrap(client.GET("/settings/all"))).data;
}

export async function createSettingsPromise(payload: {
    effective_date: string;
    elo_const_k: number;
    elo_const_d: number;
    starting_elo: number;
    win_reward: number;
}): Promise<void> {
    await unwrap(client.POST("/settings", { body: payload }));
}

export async function deleteSettingsPromise(effectiveDate: string): Promise<void> {
    await unwrap(client.DELETE("/settings", {
        body: { effective_date: effectiveDate },
    }));
}
