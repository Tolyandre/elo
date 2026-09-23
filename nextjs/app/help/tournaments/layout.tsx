import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Турниры — Справка",
    description:
        "Турниры: запись участников, планы сеток, столы и партии, автоматическая арена турнира. Пример турнира с двойным выбыванием.",
};

export default function HelpTournamentsLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
