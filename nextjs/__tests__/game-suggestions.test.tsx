// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// game-suggestions imports the API client (env-var gated) — only the chips'
// rendering is under test here.
vi.mock("@/app/api", () => ({
    suggestGamesPromise: vi.fn(),
}));

import { GameSuggestionChips, suggestionMeta } from "@/components/game-suggestions";
import type { GameSuggestion } from "@/app/api";

function render(ui: React.ReactElement): void {
    document.body.innerHTML = "";
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
        // Loading is not "no results": the linking header stays hidden.
        expect(document.body.textContent).not.toContain("Привязать к BGG / Tesera");
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

    it("renders every suggestion — the server already caps the list, no local slice", () => {
        const six = Array.from({ length: 6 }, (_, i): GameSuggestion => ({
            ...carcassonne,
            bgg_ref: carcassonne.bgg_ref! + i + 1,
            title: `Carcassonne ${i + 2}`,
            name_en: `Carcassonne ${i + 2}`,
        }));
        render(
            <GameSuggestionChips
                suggestions={six}
                accepted={null}
                onAccept={() => {}}
                onClear={() => {}}
            />,
        );
        const chips = Array.from(document.body.querySelectorAll("button"));
        expect(chips).toHaveLength(6);
        expect(chips.map((b) => b.textContent)).toContain("Carcassonne 7 (2000)");
    });

    it("shows both canonical names in one chip, without duplicates", () => {
        const stayCool: GameSuggestion = {
            ...carcassonne,
            bgg_ref: 395766,
            title: "Stay Cool",
            name_en: "Stay Cool",
            name_ru: "Не бомбани!",
            year: 2023,
        };
        render(
            <GameSuggestionChips
                suggestions={[stayCool]}
                accepted={null}
                onAccept={() => {}}
                onClear={() => {}}
            />,
        );
        expect(document.body.textContent).toContain("Stay Cool · Не бомбани! (2023)");
    });

    it("keeps the clicked chip's label verbatim in the accepted state", () => {
        const stayCool: GameSuggestion = {
            ...carcassonne,
            bgg_ref: 395766,
            title: "Stay Cool",
            name_en: "Stay Cool",
            name_ru: "Не бомбани!",
            year: 2023,
        };
        render(
            <GameSuggestionChips
                suggestions={[]}
                accepted={suggestionMeta(stayCool)}
                onAccept={() => {}}
                onClear={() => {}}
            />,
        );
        // Accepting highlights the same pill — it must not collapse to the
        // Russian-only name, and the linking header stays above it.
        expect(document.body.querySelector("button")!.textContent).toBe(
            "Stay Cool · Не бомбани! (2023)",
        );
        expect(document.body.textContent).toContain("Привязать к BGG / Tesera");
    });

    it("dims addition chips the way the admin picker does", () => {
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
        const chips = Array.from(document.body.querySelectorAll("button"));
        expect(chips[0].className).not.toContain("opacity-70");
        expect(chips[1].className).toContain("opacity-70");
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
