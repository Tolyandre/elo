// Centralized date/time formatting. Replaces the local `formatDate`/`fmt`/inline
// `toLocaleString(...)` copies that were scattered across components and pages.
// Output is identical to the formatters it replaces.

/** Locale for explicit (non-undefined) formatting. */
export const LOCALE = "ru-RU" as const;

/** Accepts an ISO string or a Date and returns a Date (null for nullish input). */
function toDate(value: string | Date): Date {
    return typeof value === "string" ? new Date(value) : value;
}

/** Short date only, e.g. "04.08.26". */
export function formatDate(value: string | Date): string {
    return toDate(value).toLocaleDateString(LOCALE, {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
    });
}

/** Time only, e.g. "14:30". */
export function formatTime(value: string | Date): string {
    return toDate(value).toLocaleTimeString(LOCALE, {
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** Medium date + short time using the ambient locale, e.g. "4 Aug, 14:30". */
export function formatDateTime(value: string | Date): string {
    return toDate(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

/** Long form: full year, long month, day + time, e.g. "4 августа 2026 г., 14:30". */
export function formatDateTimeLong(value: string | Date): string {
    return toDate(value).toLocaleDateString(LOCALE, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}
