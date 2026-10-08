import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Сообщества и клубы — Справка",
    description:
        "Что такое сообщество и клуб, как членство определяется клубами, как работает открытость (все партии, есть участник, только участники) и что остаётся общим для всех.",
};

export default function HelpTenantsLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
