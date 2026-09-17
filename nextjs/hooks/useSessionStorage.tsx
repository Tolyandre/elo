"use client";

import { useState } from 'react';

/**
 * @param key          Session storage key
 * @param initialValue Default value if key is not found
 * @returns [value, setValue] — setValue accepts a plain value or a functional
 *          update (same contract as useState), so callers updating from the
 *          previous value never build on a stale object.
 */
export function useSessionStorage<T>(
    key: string,
    initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
    const [state, setInternalState] = useState<T>(() => {
        try {
            const stored = sessionStorage.getItem(key);
            return stored !== null ? JSON.parse(stored) : initialValue;
        } catch {
            return initialValue;
        }
    });

    const setState = (value: T | ((prev: T) => T)) => {
        setInternalState((prev) => {
            const next = typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
            sessionStorage.setItem(key, JSON.stringify(next));
            return next;
        });
    };

    return [state, setState];
}
