import { useCallback, useMemo, useState } from "react";
import { useCamps, type CampArena } from "@/app/arenas/campsContext";
import type { Base58ID } from "@/lib/id";

/** Explicit user toggles keyed by camp id; win over the base set. */
export type CampOverrides = Partial<Record<string, boolean>>;

/**
 * Shared camp-selection logic for every match-save screen (the match form and
 * the calculators), so the ADR-27 rules live in one place:
 *
 * - Create: one checkbox per camp arena whose window contains the match date;
 *   a camp is checked by default iff ANY of the selected players already has
 *   a settlement there (derived participants). The user may check/uncheck
 *   freely.
 * - Edit: the same checkboxes, pre-checked with the match's current camps
 *   (`selectedIds`). Links are editable — editing exists to fix mistakes, and
 *   the server diffs the submitted set (attach/detach, audited) and recalcs
 *   both camps. A camp whose window no longer contains the edited date stays
 *   visible and checked; saving then fails with the server's 409 unless it is
 *   unticked in the same edit.
 *
 * `playerIds` are the match participants. Explicit user toggles are carried
 * in `overrides`, which the hook owns in component state unless the caller
 * injects its own pair — the match form injects the session-storage-backed
 * pair so toggles survive a refresh via its draft.
 */
export type CampSelection = {
    /** Checkboxes to render: camps active on the date, plus the match's camps on edit. */
    active: CampArena[];
    /** Effective checked set (base + overrides). */
    checked: Base58ID[];
    toggle: (id: Base58ID, checked: boolean) => void;
    /** The set to submit: the checked ids. */
    idsToSubmit: () => Base58ID[];
};

export function useCampSelection(
    playerIds: Base58ID[],
    date: Date,
    opts?: {
        /** The match's current camps on edit — the pre-checked base set. */
        selectedIds?: Base58ID[];
        /** Explicit user toggles keyed by camp id; wins over the base set. */
        overrides?: CampOverrides;
        setOverrides?: (updater: (prev: CampOverrides) => CampOverrides) => void;
    },
): CampSelection {
    const { camps, activeCamps } = useCamps();
    // Destructured so the memo dependencies stay value-stable even though
    // callers pass a fresh options object.
    const selectedIds = opts?.selectedIds;
    const isEdit = !!selectedIds;
    const [ownOverrides, setOwnOverrides] = useState<CampOverrides>({});
    const overrides = opts?.overrides ?? ownOverrides;
    const setOverrides = opts?.setOverrides ?? setOwnOverrides;
    // Checkboxes shown: camps whose window contains the date, plus the
    // match's current camps on edit — unticking one of those is exactly the
    // fix the edit form exists for. A camp missing from the preload renders
    // with a placeholder name but its id still travels.
    const active = useMemo(() => {
        const windowActive = activeCamps(date);
        if (!isEdit || selectedIds.length === 0) return windowActive;
        const byId = new Map(camps.map((c) => [c.id, c]));
        const selected = selectedIds.map(
            (id): CampArena =>
                byId.get(id) ?? { id, name: "Кэмп", starts_at: "", ends_at: "", player_ids: [] },
        );
        const seen = new Set(windowActive.map((c) => c.id));
        return [...windowActive, ...selected.filter((c) => !seen.has(c.id))];
    }, [isEdit, selectedIds, camps, activeCamps, date]);

    // Base set: the match's camps on edit; the participation default
    // (any of the match's players has a settlement there) on create.
    const playerKey = useMemo(() => [...new Set(playerIds)].sort().join(" "), [playerIds]);
    const baseChecked = useMemo(() => {
        if (isEdit) return [...selectedIds];
        const ids = playerKey ? playerKey.split(" ") : [];
        if (ids.length === 0) return [];
        return active
            .filter((c) => {
                const members = new Set(c.player_ids.map(String));
                return ids.some((pid) => members.has(pid));
            })
            .map((c) => c.id);
    }, [isEdit, selectedIds, active, playerKey]);

    const checked = useMemo(() => {
        const explicit = overrides ?? {};
        return active
            .filter((c) => explicit[String(c.id)] ?? baseChecked.includes(c.id))
            .map((c) => c.id);
    }, [active, baseChecked, overrides]);

    // The updater form keeps consecutive toggles correct even when the
    // state update has not re-rendered the hook yet.
    const toggle = useCallback(
        (id: Base58ID, on: boolean) => {
            setOverrides((prev) => ({ ...prev, [String(id)]: on }));
        },
        [setOverrides],
    );

    const idsToSubmit = useCallback(
        () => checked.filter((id) => active.some((c) => c.id === id)),
        [checked, active],
    );

    return { active, checked, toggle, idsToSubmit };
}
