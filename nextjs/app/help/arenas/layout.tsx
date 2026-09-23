import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Арены и лиги — Справка",
    description:
        "Глобальная и игровые арены, структура лиг и условия перехода, как устроен рейтинг новичков и сколько побед нужно для выхода из Лиги Новичков.",
};

export default function HelpArenasLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
