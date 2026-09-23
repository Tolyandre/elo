import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Рейтинг Эло в настольных играх — Справка",
    description:
        "Что такое рейтинг Эло, формулы расчёта для многопользовательских партий, каким играм он подходит и интерактивный пример расчёта.",
};

export default function HelpEloLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
