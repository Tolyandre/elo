"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
import { useMe } from "@/app/meContext";
import { LoginLink } from "@/components/login-link";

/**
 * Shows an alert if the user is not logged in or lacks edit permission.
 * Returns null when the user can save matches.
 */
export function AuthWarning() {
    const me = useMe();

    if (!me.id) {
        return (
            <Alert>
                <AlertCircleIcon />
                <AlertTitle>Для сохранения партии потребуется выполнить вход</AlertTitle>
                <AlertDescription className="flex flex-col items-start gap-2">
                    <span>Результаты временно хранятся в браузере</span>
                    <LoginLink />
                </AlertDescription>
            </Alert>
        );
    }

    if (!me.canEdit) {
        return (
            <Alert>
                <AlertCircleIcon />
                <AlertTitle><b>{me.name}</b> пока не можете добавлять партии</AlertTitle>
                <AlertDescription>Кто-то должен разрешить вам доступ</AlertDescription>
            </Alert>
        );
    }

    return null;
}
