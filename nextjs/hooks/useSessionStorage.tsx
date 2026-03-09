"use client";

import { useState } from 'react';

/**
 * @param key          Session storage key
 * @param initialValue Default value if key is not found
 * @returns [value, setValue]
 */
export function useSessionStorage<T>(
    key: string,
    initialValue: T
): [T, (value: T) => void] {
    const [state, setInternalState] = useState<T>(() => {
        try {
            const stored = sessionStorage.getItem(key);
            return stored !== null ? JSON.parse(stored) : initialValue;
        } catch {
            return initialValue;
        }
    });

    const setState = (value: T) => {
        sessionStorage.setItem(key, JSON.stringify(value));
        setInternalState(value);
    };

    return [state, setState];
}
