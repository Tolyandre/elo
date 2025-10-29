"use client";

import { deleteCache } from "@/app/api";
import React from "react";

type Props = {
    onInvalidate?: () => void;
    ariaLabel?: string;
    title?: string;
};

export default function RefreshButton({ onInvalidate, ariaLabel = "Refresh", title = "Обновить" }: Props) {
    const onClick = async () => {
        await deleteCache();
        onInvalidate?.();
    };

    return (
        <button
            onClick={onClick}
            aria-label={ariaLabel}
            className="ml-3 p-2 rounded text-gray-700 hover:bg-gray-200"
            title={title}
        >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M21 3V8M21 8H16M21 8L18 5.29168C16.4077 3.86656 14.3051 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21C16.2832 21 19.8675 18.008 20.777 14" />
            </svg>
        </button>
    );
}
