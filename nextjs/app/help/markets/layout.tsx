import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Рынок предсказаний — Справка",
    description:
        "Ставки рейтинга на исходы: как устроен рынок, кто такие поручители, алгоритм маркет-мейкера и формулы расчёта. Интерактивный тренажёр рынка.",
};

export default function HelpMarketsLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
