// If the editor didn't touch a field, the server's value wins; if they did,
// their value wins (equal edits collapse naturally). Values compare by
// reference/identity: object fields that need value equality get their own
// same-check in the per-game merge.
export function threeWay<T>(base: T, local: T, fresh: T): T {
    return local === base ? fresh : local;
}
