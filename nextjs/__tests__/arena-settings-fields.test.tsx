// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import {
    ArenaSettingsFields,
    initialSettingsValues,
    type ArenaSettingsValues,
} from "@/components/arena-settings-editor";

function renderFields(values: ArenaSettingsValues, props: { startingElo?: number; withLeagues?: boolean } = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(
            <ArenaSettingsFields values={values} onChange={() => {}} {...props} />,
        );
    });
    const text = () => container.textContent ?? "";
    return {
        text,
        unmount() {
            act(() => {
                root.unmount();
            });
            container.remove();
        },
    };
}

describe("ArenaSettingsFields", () => {
    it("asks for the elite match counts when a league below elite exists", () => {
        const values = initialSettingsValues(null);
        values.leagues.elite = true;
        const rendered = renderFields(values);
        expect(rendered.text()).toContain("Партий за полгода");
        expect(rendered.text()).toContain("Партий за 2 месяца");
        rendered.unmount();
    });

    it("hides the elite match counts in an elite-only arena — everyone is elite from the start", () => {
        const values = initialSettingsValues(null);
        values.leagues.newbie = false;
        values.leagues.amateur = false;
        values.leagues.elite = true;
        const rendered = renderFields(values);
        expect(rendered.text()).not.toContain("Партий за полгода");
        expect(rendered.text()).not.toContain("Партий за 2 месяца");
        rendered.unmount();
    });

    it("keeps the catch-up params when the newbie league is off — the catch-up works in any arena", () => {
        const values = initialSettingsValues(null);
        values.leagues.newbie = false;
        const rendered = renderFields(values);
        expect(rendered.text()).toContain("Мин. очков за победу");
        expect(rendered.text()).toContain("Макс. очков за победу");
        expect(rendered.text()).toContain("τ");
        // Разрыв эло stays a newbie-league setting.
        expect(rendered.text()).not.toContain("Разрыв эло");
        rendered.unmount();
    });

    it("shows the goal gap only with the newbie league", () => {
        const values = initialSettingsValues(null);
        const rendered = renderFields(values);
        expect(rendered.text()).toContain("Разрыв эло");
        rendered.unmount();
    });

    it("shows the starting elo for reference when provided", () => {
        const values = initialSettingsValues(null);
        const rendered = renderFields(values, { startingElo: 1000 });
        expect(rendered.text()).toContain("Стартовое эло:");
        expect(rendered.text()).toContain("1000");
        rendered.unmount();

        const without = renderFields(values);
        expect(without.text()).not.toContain("Стартовое эло:");
        without.unmount();
    });

    it("renders a camp (withLeagues=false) as the rating group alone", () => {
        const values = initialSettingsValues(null, { startingRating: "1000", withLeagues: false });
        const rendered = renderFields(values, { withLeagues: false });
        expect(rendered.text()).toContain("Стартовый рейтинг:");
        expect(rendered.text()).toContain("Мин. очков за победу");
        expect(rendered.text()).not.toContain("Новички");
        expect(rendered.text()).not.toContain("Разрыв эло");
        rendered.unmount();
    });
});
