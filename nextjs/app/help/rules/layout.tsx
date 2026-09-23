import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Цели и правила использования — Справка",
    description:
        "Зачем рейтингу существовать, правила дружелюбного использования и кто вносит результаты партий.",
};

export default function HelpRulesLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
