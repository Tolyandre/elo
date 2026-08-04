"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Screen wake lock for the live calculator pages, where the device should not
 * sleep while a round is in progress.
 *
 * Replaces the inline wake-lock blocks in the calculator pages with a
 * self-contained hook: typed via the DOM `WakeLockSentinel`, with a
 * visibilitychange re-acquire handler and release-on-unmount cleanup.
 */

function getWakeLock(): WakeLock | undefined {
    return typeof window !== "undefined" ? navigator.wakeLock : undefined;
}

export function useWakeLock(): {
    supported: boolean;
    enabled: boolean;
    toggle: () => Promise<void>;
    acquire: () => Promise<void>;
    release: () => void;
} {
    const wakeLockRef = useRef<WakeLockSentinel | null>(null);
    const [enabled, setEnabled] = useState(false);
    const supported = !!getWakeLock();

    const acquire = useCallback(async () => {
        const api = getWakeLock();
        if (!api) return;
        try {
            const sentinel = await api.request("screen");
            wakeLockRef.current = sentinel;
            setEnabled(true);
            sentinel.addEventListener("release", () => {
                setEnabled(false);
                wakeLockRef.current = null;
            });
        } catch {
            setEnabled(false);
        }
    }, []);

    const release = useCallback(() => {
        wakeLockRef.current?.release().catch(() => {});
        wakeLockRef.current = null;
        setEnabled(false);
    }, []);

    const toggle = useCallback(async () => {
        if (enabled) {
            release();
        } else {
            await acquire();
        }
    }, [enabled, acquire, release]);

    // Re-acquire when the tab becomes visible again (wake locks are dropped on
    // backgrounding).
    useEffect(() => {
        if (!enabled) return;
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") acquire();
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    }, [enabled, acquire]);

    // Release on unmount.
    useEffect(() => {
        return () => {
            wakeLockRef.current?.release();
        };
    }, []);

    return { supported, enabled, toggle, acquire, release };
}
