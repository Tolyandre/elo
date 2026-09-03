"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Preference key: whether the user wants the screen kept awake. Written on
 * manual toggles only (programmatic acquire/release from the chess clock
 * leaves it alone) and re-applied best-effort on load.
 */
const WAKE_LOCK_PREF_KEY = "wake-lock/enabled";

function getWakeLock(): WakeLock | undefined {
    return typeof window !== "undefined" ? navigator.wakeLock : undefined;
}

/**
 * Screen wake lock for the live calculator pages, where the device should not
 * sleep while a round is in progress.
 *
 * Two layers of state:
 *   - `enabled` — the user's intent (what the toggle button shows); persisted
 *     across reloads as a preference and restored on mount.
 *   - the actually-held sentinel — wake locks are released by the OS when the
 *     tab hides, so a visibilitychange handler re-acquires while enabled.
 *
 * Restoring on load is best-effort: some browsers reject `request()` without
 * user activation, in which case the preference simply waits for the next
 * manual toggle.
 */
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
        if (!api || wakeLockRef.current) return;
        try {
            const sentinel = await api.request("screen");
            wakeLockRef.current = sentinel;
            setEnabled(true);
            // The OS releases wake locks when the tab hides. That is not a
            // change of intent — the visibilitychange handler re-acquires —
            // so only the sentinel is cleared here.
            sentinel.addEventListener("release", () => {
                wakeLockRef.current = null;
            });
        } catch {
            // Rejected (e.g. no user activation in some browsers): this
            // session stays unlocked; the preference remains for the next
            // manual toggle, which provides the gesture.
            setEnabled(false);
        }
    }, []);

    const release = useCallback(() => {
        const sentinel = wakeLockRef.current;
        wakeLockRef.current = null;
        setEnabled(false);
        sentinel?.release().catch(() => {});
    }, []);

    const toggle = useCallback(async () => {
        if (enabled) {
            release();
            try {
                localStorage.setItem(WAKE_LOCK_PREF_KEY, "false");
            } catch {
                // storage unavailable — session-only preference
            }
        } else {
            await acquire();
            if (wakeLockRef.current) {
                try {
                    localStorage.setItem(WAKE_LOCK_PREF_KEY, "true");
                } catch {
                    // storage unavailable — session-only preference
                }
            }
        }
    }, [enabled, acquire, release]);

    // Restore the persisted preference on mount and try to honor it.
    useEffect(() => {
        let stored = false;
        try {
            stored = localStorage.getItem(WAKE_LOCK_PREF_KEY) === "true";
        } catch {
            // storage unavailable — start off
        }
        if (!stored) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe hydration: localStorage is only available after mount
        setEnabled(true);
        if (document.visibilityState === "visible") {
            acquire();
        }
    }, [acquire]);

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
