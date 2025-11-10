"use client";

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { oauth2Callback } from '../api';

export default function Oauth2CallbackClient() {
    const searchParams = useSearchParams();
    const [status, setStatus] = useState<{ status: string; error?: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        const params: Record<string, string | string[]> = {};
        if (!searchParams) return;

        // collect all params, supporting repeated keys
        for (const key of searchParams.keys()) {
            const values = searchParams.getAll(key);
            if (values.length > 1) params[key] = values;
            else params[key] = values[0];
        }

        (async () => {
            try {
                const res = await oauth2Callback(params);
                setStatus(res);

                setTimeout(() => {
                    router.push("/players");
                }, 1200);

            } catch (err: any) {
                setStatus({ status: 'fail', error: err?.message ?? String(err) });
            } finally {
                setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div style={{ padding: 20 }}>
            <h1>OAuth2 callback</h1>
            {loading && <p>Processing...</p>}
            {!loading && status?.status === 'success' && <p>Authentication successful.</p>}
            {!loading && status?.status === 'fail' && (
                <div>
                    <p>Authentication failed.</p>
                    {status.error && <pre style={{ color: 'red' }}>{status.error}</pre>}
                </div>
            )}
            {!loading && !status && <p>No response.</p>}
        </div>
    );
}
