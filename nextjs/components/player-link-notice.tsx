"use client";

import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
import { useMe } from "@/app/meContext";
import { LoginLink } from "@/components/login-link";
import { Button } from "@/components/ui/button";

/**
 * Banner for actions that need both a login and a linked player (tournament
 * registration, bets). Same Alert style as AuthWarning; renders nothing while
 * the identity loads or once the player is linked.
 */
export function PlayerLinkNotice({ action }: { action: string }) {
    const me = useMe();

    if (me.loading || (me.isAuthenticated && me.playerId != null)) return null;

    return (
        <Alert>
            <AlertCircleIcon />
            <AlertTitle>
                {me.isAuthenticated
                    ? `Чтобы ${action}, привяжите своего игрока`
                    : `Чтобы ${action}, выполните вход и привяжите своего игрока`}
            </AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
                <span>Игрок привязывается на странице «Мои настройки»</span>
                {me.isAuthenticated ? (
                    <Button asChild size="sm" variant="outline">
                        <Link href="/settings">Мои настройки</Link>
                    </Button>
                ) : (
                    <LoginLink />
                )}
            </AlertDescription>
        </Alert>
    );
}
