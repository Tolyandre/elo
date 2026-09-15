// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Base58ID } from "@/lib/id";
import { PageHeaderProvider } from "@/app/pageHeaderContext";
import type { UpdateArenasResult } from "@/app/api";

const mocks = vi.hoisted(() => ({
    me: {
        id: "user1" as string | undefined,
        name: "Danis",
        canEdit: true,
        loading: false,
    },
    updateArenas: vi.fn<() => Promise<UpdateArenasData>>(),
}));

vi.mock("@/app/api", () => ({
    updateArenasPromise: mocks.updateArenas,
}));

vi.mock("@/app/meContext", () => ({
    useMe: () => mocks.me,
}));

// The real dialog is a radix portal; the flow under test is the page's wiring
// (gating → confirm → report rendering), so a controlled stub keeps jsdom simple.
vi.mock("@/components/confirm-dialog", () => ({
    ConfirmDialog: (props: {
        open: boolean;
        title: string;
        description?: string;
        confirmText?: string;
        onConfirm: () => void;
    }) =>
        props.open ? (
            <div data-testid="confirm-dialog">
                <div>{props.title}</div>
                <div>{props.description}</div>
                <button onClick={() => props.onConfirm()}>{props.confirmText}</button>
            </div>
        ) : null,
}));

import DebugPage from "@/app/debug/page";

const pid = (s: string) => s as Base58ID;

type UpdateArenasData = UpdateArenasResult["data"];

function report(overrides: Partial<UpdateArenasData["global"]> = {}): UpdateArenasData {
    return {
        global: { matches_replayed: 3, corrections_replayed: 1, changed_players: [], ...overrides },
        arenas: [],
    };
}

function renderPage() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(
            <PageHeaderProvider>
                <DebugPage />
            </PageHeaderProvider>,
        );
    });
    const buttonWithText = (text: string) =>
        Array.from(container.querySelectorAll("button")).find(
            (b) => b.textContent?.trim() === text,
        ) as HTMLButtonElement | undefined;
    return {
        buttonWithText,
        dialog: () => container.querySelector("[data-testid=confirm-dialog]"),
        text: () => container.textContent ?? "",
        unmount() {
            act(() => {
                root.unmount();
            });
            container.remove();
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.me = { id: "user1", name: "Danis", canEdit: true, loading: false };
});

describe("DebugPage arena update", () => {
    it("disables the button and warns a non-editor", () => {
        mocks.me = { id: "user1", name: "Danis", canEdit: false, loading: false };
        const view = renderPage();

        expect(view.buttonWithText("Обновить арены")?.disabled).toBe(true);
        expect(view.text()).toContain("пока не можете добавлять партии");
        view.unmount();
    });

    it("runs the update after confirm and reports no drift", async () => {
        mocks.updateArenas.mockResolvedValue(report());
        const view = renderPage();

        act(() => {
            view.buttonWithText("Обновить арены")!.click();
        });
        expect(view.dialog()).not.toBeNull();

        await act(async () => {
            view.buttonWithText("Обновить")!.click();
            await Promise.resolve();
        });

        expect(mocks.updateArenas).toHaveBeenCalledTimes(1);
        expect(view.text()).toContain("Расхождений нет");
        expect(view.text()).toContain("переиграно партий 3, коррекций 1");
        expect(view.dialog()).toBeNull();
        view.unmount();
    });

    it("lists every changed player with full-precision before → after values", async () => {
        mocks.updateArenas.mockResolvedValue(
            report({
                changed_players: [
                    {
                        player_id: pid("p1"),
                        player_name: "Alice",
                        elo_before: 1050.5,
                        elo_after: 1050.50000001,
                        rating_before: 1102.25,
                        rating_after: 1102.3,
                        league_before: "amateur",
                        league_after: "pro",
                    },
                ],
            }),
        );
        const view = renderPage();

        act(() => {
            view.buttonWithText("Обновить арены")!.click();
        });
        await act(async () => {
            view.buttonWithText("Обновить")!.click();
            await Promise.resolve();
        });

        expect(view.text()).toContain("Обнаружены расхождения: 1");
        expect(view.text()).toContain("Alice");
        // Full precision: float-level drift must stay visible.
        expect(view.text()).toContain("1050.50000001");
        expect(view.text()).toContain("1102.25");
        expect(view.text()).toContain("1102.3");
        expect(view.text()).toContain("pro");
        view.unmount();
    });

    it("summarizes the other arenas' reports", async () => {
        mocks.updateArenas.mockResolvedValue({
            global: { matches_replayed: 1, corrections_replayed: 0, changed_players: [] },
            arenas: [
                {
                    arena_id: pid("a1"),
                    arena_name: "Арена: Skull King",
                    matches_replayed: 12,
                    changed_players: [],
                },
            ],
        });
        const view = renderPage();

        act(() => {
            view.buttonWithText("Обновить арены")!.click();
        });
        await act(async () => {
            view.buttonWithText("Обновить")!.click();
            await Promise.resolve();
        });

        expect(view.text()).toContain("Арена: Skull King");
        expect(view.text()).toContain("12");
        view.unmount();
    });

    it("keeps the dialog open when the update fails", async () => {
        mocks.updateArenas.mockRejectedValue(new Error("boom"));
        const view = renderPage();

        act(() => {
            view.buttonWithText("Обновить арены")!.click();
        });
        await act(async () => {
            view.buttonWithText("Обновить")!.click();
            await Promise.resolve();
        });

        expect(view.dialog()).not.toBeNull();
        view.unmount();
    });
});
