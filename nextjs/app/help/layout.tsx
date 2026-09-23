import type { Metadata } from "next";
import { HelpShell } from "./help-shell";

export const metadata: Metadata = {
    title: "Справка",
    description:
        "Документация: рейтинг Эло для настольных игр, арены и лиги, рынок предсказаний, турниры, цели и правила.",
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
    return <HelpShell>{children}</HelpShell>;
}
