"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { oauth2Callback } from '../api';
import { useMe } from '../meContext';

export default function Oauth2CallbackClient() {
    const searchParams = useSearchParams();
    const [error, setError] = useState<string | null>(null);
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
                toast.success('Authentication successful', { id: toastId, position: 'top-center' });
                me.invalidate();
                router.push("/players");
            } catch (err: any) {
                const message = err?.message ?? String(err);
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

    return null;
}
