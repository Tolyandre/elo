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

function renderFields(values: ArenaSettingsValues) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<ArenaSettingsFields values={values} onChange={() => {}} />);
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

    it("hides the newbie params when the newbie league is off", () => {
        const values = initialSettingsValues(null);
        values.leagues.newbie = false;
        const rendered = renderFields(values);
        expect(rendered.text()).not.toContain("Разрыв эло");
        rendered.unmount();
    });
});
