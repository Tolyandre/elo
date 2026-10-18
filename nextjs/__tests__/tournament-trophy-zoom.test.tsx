// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

// Enable React's act() environment so async state updates don't warn.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { TournamentTrophyZoom } from "@/components/tournament-trophy-mark";
import type { Tournament } from "@/app/api";

function renderZoom(trophy?: string) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<TournamentTrophyZoom tournament={{ trophy } as unknown as Tournament} className="h-20 w-20" />);
    });
    return {
        unmount: () => {
            act(() => {
                root.unmount();
            });
            container.remove();
        },
    };
}

/** The dialog portals to document.body, so lookups go through document.body. */
function findTrigger(): HTMLButtonElement {
    const button = Array.from(document.body.querySelectorAll("button")).find((b) =>
        b.getAttribute("aria-label")?.startsWith("Кубок: "),
    );
    if (!button) throw new Error("trophy zoom trigger not found");
    return button;
}

describe("TournamentTrophyZoom", () => {
    it("without pool art the generic cup stays a plain, non-interactive mark", () => {
        const { unmount } = renderZoom(undefined);
        expect(document.body.querySelector("button")).toBeNull();
        expect(document.body.querySelector("svg")).not.toBeNull();
        expect(document.body.querySelector("img")).toBeNull();
        unmount();
    });

    it("an unknown token degrades to the generic cup too", () => {
        const { unmount } = renderZoom("gone");
        expect(document.body.querySelector("button")).toBeNull();
        expect(document.body.querySelector("img")).toBeNull();
        unmount();
    });

    it("clicking the champion-banner cup opens it uncropped and viewport-sized", () => {
        const { unmount } = renderZoom("innovation");

        const trigger = findTrigger();
        expect(trigger.getAttribute("aria-label")).toBe("Кубок: innovation — показать целиком");
        // The banner mark itself is the cropped circle…
        const mark = trigger.querySelector("img");
        expect(mark?.getAttribute("src")).toContain("/trophies/innovation.svg");
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();

        act(() => {
            trigger.click();
        });

        // …while the dialog shows the same file uncropped (object-contain).
        const dialog = document.body.querySelector('[role="dialog"]');
        expect(dialog).not.toBeNull();
        const full = dialog!.querySelector("img");
        expect(full?.getAttribute("src")).toContain("/trophies/innovation.svg");
        expect(full?.className).toContain("object-contain");
        expect(full?.className).toContain("max-h-[80vh]");
        unmount();
    });
});
