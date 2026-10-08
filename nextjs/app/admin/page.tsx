"use client"
import Link from "next/link";
import { Dices, House, Sigma, TrendingUp, Users, UsersRound } from "lucide-react";
import { PageHeader } from "@/app/pageHeaderContext";
import { PageContainer } from "@/components/page-container";
import { MeepleIcon } from "@/components/meeple-icon";
import { Button } from "@/components/ui/button";

const ADMIN_LINKS = [
    { href: "/admin/users", label: "Пользователи", icon: Users },
    { href: "/admin/players", label: "Игроки", icon: MeepleIcon },
    { href: "/admin/games", label: "Игры", icon: Dices },
    { href: "/admin/tenants", label: "Сообщества", icon: UsersRound },
    { href: "/admin/clubs", label: "Клубы", icon: House },
    { href: "/admin/markets", label: "Рынки ставок", icon: TrendingUp },
    { href: "/admin/formula", label: "Настройка формулы Elo", icon: Sigma },
] as const;

export default function AdminPage() {
    return (
        <PageContainer width="narrow">
            <PageHeader title="Администрирование" />

            <div className="flex flex-col items-center">
                <div className="flex w-full flex-col gap-2">
                    {ADMIN_LINKS.map(({ href, label, icon: Icon }) => (
                        <Button key={href} asChild variant="outline" className="w-full justify-start">
                            <Link href={href}>
                                <Icon /> {label}
                            </Link>
                        </Button>
                    ))}
                </div>
            </div>
        </PageContainer>
    );
}
