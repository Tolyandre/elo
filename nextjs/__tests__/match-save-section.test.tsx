// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Base58ID } from "../lib/id";
import type { CampSelection } from "../hooks/useCampSelection";

const { MatchSaveSection } = await import("../components/tables/match-save-section");

const selection: CampSelection = {
    active: [
        { id: "c1" as Base58ID, name: "Открытый кэмп", starts_at: "", ends_at: "", player_ids: [] },
    ],
    checked: ["c1" as Base58ID],
    toggle: vi.fn(),
    idsToSubmit: () => ["c1" as Base58ID],
};

function render(jsx: React.ReactNode) {
    const container = document.createElement("div");
    act(() => {
        createRoot(container).render(jsx);
    });
    return container;
}

describe("MatchSaveSection", () => {
    it("renders the camp checkboxes, the error line, and the save control", () => {
        const c = render(
            <MatchSaveSection selection={selection} error="Не удалось сохранить">
                <button>Сохранить партию</button>
            </MatchSaveSection>,
        );
        expect(c.querySelector('input[type="checkbox"]')).not.toBeNull();
        expect(c.textContent).toContain("Открытый кэмп");
        expect(c.textContent).toContain("Не удалось сохранить");
        expect(c.textContent).toContain("Сохранить партию");
    });

    it("omits the error line when there is no error", () => {
        const c = render(
            <MatchSaveSection selection={selection}>
                <button>Сохранить</button>
            </MatchSaveSection>,
        );
        expect(c.querySelector("p")).toBeNull();
    });

    it("wires the checkbox to selection.toggle", () => {
        const c = render(
            <MatchSaveSection selection={selection}>
                <button>Сохранить</button>
            </MatchSaveSection>,
        );
        const input = c.querySelector('input[type="checkbox"]') as HTMLInputElement;
        act(() => {
            input.click();
        });
        expect(selection.toggle).toHaveBeenCalledWith("c1", false);
    });

    it("renders only the save control when no camps are active", () => {
        const empty: CampSelection = { ...selection, active: [], checked: [] };
        const c = render(
            <MatchSaveSection selection={empty}>
                <button>Сохранить</button>
            </MatchSaveSection>,
        );
        expect(c.querySelector('input[type="checkbox"]')).toBeNull();
        expect(c.textContent).toContain("Сохранить");
    });
});
