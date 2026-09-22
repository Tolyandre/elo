"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { oauth2Callback, getMePromise, EloWebServiceBaseUrl, type User } from '../api';
import { useMe } from '../meContext';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircleIcon } from 'lucide-react';
import { LoginLink } from '@/components/login-link';

export default function Oauth2CallbackClient() {
    const searchParams = useSearchParams();
    const [error, setError] = useState<string | null>(null);
    const [cookieBlocked, setCookieBlocked] = useState(false);
    const router = useRouter();
    const me = useMe();
    const ran = useRef(false);

    useEffect(() => {
        if (ran.current) return;
        ran.current = true;

        const params: Record<string, string | string[]> = {};
        if (!searchParams) return;

        // collect all params, supporting repeated keys
        for (const key of searchParams.keys()) {
            const values = searchParams.getAll(key);
            if (values.length > 1) params[key] = values;
            else params[key] = values[0];
        }

        const toastId = toast.loading('Signing you in…', { position: 'top-center' });

        (async () => {
            try {
                await oauth2Callback(params);
                // The backend answered and sent Set-Cookie, but the cookie lives
                // on the API domain — cross-site to the frontend. Strict browsers
                // (Enhanced Tracking Protection in Firefox, Opera's tracker
                // blocking) drop it silently, so verify the session really took
                // before navigating. getMePromise returns undefined only on a
                // definitive 401 — the cookie did not survive.
                let user: User | undefined;
                let checkFailed = false;
                try {
                    user = await getMePromise();
                } catch {
                    // Transient network/server error — session state unknown,
                    // not a blocked cookie; proceed and let meContext show it.
                    checkFailed = true;
                }

                if (!checkFailed && !user) {
                    toast.error('Authentication cookie was blocked', { id: toastId, position: 'top-center' });
                    setCookieBlocked(true);
                } else {
                    toast.success('Authentication successful', { id: toastId, position: 'top-center' });
                    // First visit (or a player never linked): send to settings
                    // to link one; the page picks the hint up from the query.
                    if (user && !user.player_id) router.push("/settings?link-player=1");
                    else router.push("/");
                }
                me.invalidate();
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                toast.error('Authentication failed', { id: toastId, description: message, position: 'top-center' });
                setError(message);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (error) {
        return (
            <div className="flex flex-col items-center gap-4 p-8">
                <p className="text-destructive font-medium">Authentication failed.</p>
                <pre className="text-sm text-muted-foreground whitespace-pre-wrap break-all max-w-prose">{error}</pre>
            </div>
        );
    }

    if (cookieBlocked) {
        return (
            <main className="max-w-sm mx-auto space-y-4">
                <Alert variant="warning">
                    <AlertCircleIcon />
                    <AlertTitle>Вход выполнен, но браузер не сохранил cookie авторизации</AlertTitle>
                    <AlertDescription className="flex flex-col items-start gap-2">
                        <span>
                            Сервер авторизации работает на другом домене ({new URL(EloWebServiceBaseUrl).hostname}), и
                            усиленная защита от отслеживания (например, в Firefox или Opera) блокирует его cookie как
                            сторонние. Разрешите cookie для этого домена в настройках браузера и войдите ещё раз.
                        </span>
                        <LoginLink label="Войти ещё раз" />
                    </AlertDescription>
                </Alert>
            </main>
        );
    }

    return null;
}
