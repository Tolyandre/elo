// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// game-suggestions imports the API client (env-var gated) — only the chips'
// rendering is under test here.
vi.mock("@/app/api", () => ({
    suggestGamesPromise: vi.fn(),
}));

import { GameSuggestionChips } from "@/components/game-suggestions";
import type { GameSuggestion } from "@/app/api";

function render(ui: React.ReactElement): void {
    const container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
        createRoot(container).render(ui);
    });
}

const carcassonne: GameSuggestion = {
    bgg_ref: 822,
    tesera_ref: null,
    name_en: "Carcassonne",
    name_ru: null,
    title: "Carcassonne",
    year: 2000,
    photo_url: null,
    is_addition: false,
};

describe("GameSuggestionChips", () => {
    it("renders nothing when idle: no suggestions, no flags, not loading", () => {
        render(<GameSuggestionChips suggestions={[]} accepted={null} onAccept={() => {}} onClear={() => {}} />);
        expect(document.body.textContent).toBe("");
    });

    it("says the catalogues are being searched while loading", () => {
        render(
            <GameSuggestionChips
                suggestions={[]}
                accepted={null}
                loading={true}
                onAccept={() => {}}
                onClear={() => {}}
            />,
        );
        expect(document.body.textContent).toContain("Ищем в каталогах…");
        // Loading is not "no results": the found-list header stays hidden.
        expect(document.body.textContent).not.toContain("Нашли в каталогах:");
    });

    it("distinguishes a failed search from an empty result", () => {
        render(
            <GameSuggestionChips
                suggestions={[]}
                accepted={null}
                failed={true}
                onAccept={() => {}}
                onClear={() => {}}
            />,
        );
        expect(document.body.textContent).toContain("Каталоги недоступны — не удалось выполнить поиск.");
    });

    it("labels additions instead of hiding them", () => {
        const addition: GameSuggestion = {
            ...carcassonne,
            title: "Carcassonne: The River",
            name_en: "Carcassonne: The River",
            is_addition: true,
        };
        render(
            <GameSuggestionChips
                suggestions={[carcassonne, addition]}
                accepted={null}
                onAccept={() => {}}
                onClear={() => {}}
            />,
        );
        const chips = Array.from(document.body.querySelectorAll("button")).map((b) => b.textContent);
        expect(chips).toContain("Carcassonne (2000)");
        expect(chips).toContain("Carcassonne: The River (2000) · дополнение");
    });

    it("renders the per-catalogue degradation hints", () => {
        render(
            <GameSuggestionChips
                suggestions={[carcassonne]}
                accepted={null}
                teseraUnavailable={true}
                bggUnavailable={true}
                onAccept={() => {}}
                onClear={() => {}}
            />,
        );
        expect(document.body.textContent).toContain("Каталог Tesera недоступен — показаны результаты BoardGameGeek.");
        expect(document.body.textContent).toContain("BoardGameGeek недоступен — показаны результаты Tesera.");
    });
});
