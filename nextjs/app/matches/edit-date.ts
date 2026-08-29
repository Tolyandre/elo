// Date fidelity for the match edit form. The datetime-local control only
// carries minutes, but stored match dates have second/millisecond precision —
// resubmitting the untouched control value would silently truncate the date
// (and the audit diff would report a change the user never made).

/**
 * Returns the original full-precision ISO date when the form's datetime-local
 * draft still represents the same minute as the original instant (the user
 * never touched the date), or null when the date was changed (or either value
 * is missing) and the draft should be submitted as-is.
 */
export function unchangedEditDateISO(editDate: string, originalISO: string): string | null {
    if (!editDate || !originalISO) return null;
    const draft = new Date(editDate).getTime();
    const original = new Date(originalISO).getTime();
    if (Number.isNaN(draft) || Number.isNaN(original)) return null;
    if (draft === original) return originalISO;
    if (Math.trunc(draft / 60000) === Math.trunc(original / 60000)) {
        return originalISO;
    }
    return null;
}
