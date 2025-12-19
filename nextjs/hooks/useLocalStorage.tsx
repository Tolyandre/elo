"use client";

import { useState, useEffect } from 'react';

/**
 * @param key          Local storage key
 * @param initialValue Default value if key is not found
 * @returns [value, setValue]
 */
export function useLocalStorage<T>(
    key: string,
    initialValue: T
): [T, (value: T) => void] {
    const [state, setInternalState] = useState<T>(initialValue);

    useEffect(() => {
        const stored = localStorage.getItem(key);
        if (stored !== null) {
            try {
                setInternalState(JSON.parse(stored));
            } catch {
            }
        }
    }, [key]);

    const setState = (value: T) => {
        localStorage.setItem(key, JSON.stringify(value));
        setInternalState(value);
    };

    return [state, setState];
}
