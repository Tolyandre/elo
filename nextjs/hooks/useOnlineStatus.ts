"use client";

import { useEffect, useState } from "react";

/**
 * Tracks navigator.onLine. Starts as online (SSR/build-safe) and corrects after mount.
 * navigator.onLine can report false positives (connected to a router without internet),
 * so callers should still treat failed fetches as "offline right now".
 */
export function useOnlineStatus(): boolean {
    const [isOnline, setIsOnline] = useState(true);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe hydration: navigator is only available after mount
        setIsOnline(navigator.onLine);
        const goOnline = () => setIsOnline(true);
        const goOffline = () => setIsOnline(false);
        window.addEventListener("online", goOnline);
        window.addEventListener("offline", goOffline);
        return () => {
            window.removeEventListener("online", goOnline);
            window.removeEventListener("offline", goOffline);
        };
    }, []);

    return isOnline;
}
