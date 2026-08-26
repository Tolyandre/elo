/**
 * Short ID encoding — mirrors the backend's pkg/id package (ADR-12).
 *
 * UUIDs are encoded as Base58 (Bitcoin alphabet) strings, ~22 chars, with no
 * ambiguous characters (0, O, I, l omitted). The backend accepts both short and
 * canonical forms on input, so encoding is only needed when the client
 * generates a new id.
 *
 * Every identifier in the app is typed as Base58ID (see app/api-types.gen.ts,
 * generated with this brand): a plain string cannot be passed where an id is
 * expected without going through toBase58ID/newId/encodeId, which are the
 * only places that mint ids.
 */

/** A wire-form identifier (Base58-encoded UUID). */
export type Base58ID = string & { readonly __base58id: "base58" };

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// Precomputed lookup: character code → index in ALPHABET (128 entries, 255 = not in alphabet).
const DECODE_MAP = new Uint8Array(128).fill(255);
for (let i = 0; i < ALPHABET.length; i++) {
    DECODE_MAP[ALPHABET.charCodeAt(i)] = i;
}

/**
 * Encode a UUID string (36-char canonical or 32-char hex) to its short Base58 form.
 */
export function encodeId(uuid: string): Base58ID {
    // Strip dashes if present.
    const hex = uuid.replace(/-/g, "");
    if (hex.length !== 32) {
        throw new Error(`encodeId: expected 32 hex chars, got ${hex.length}`);
    }

    // Count leading zero bytes (each "00" in hex = one zero byte = one leading '1').
    let zeros = 0;
    for (let i = 0; i < 32; i += 2) {
        if (hex[i] === "0" && hex[i + 1] === "0") {
            zeros++;
        } else {
            break;
        }
    }

    // Convert hex string to a BigInt (base 16).
    const num = BigInt("0x" + hex);

    // Convert to Base58 (reversed).
    const result: string[] = [];
    let n = num;
    if (n === 0n) {
        result.push(ALPHABET[0]);
    } else {
        const base = BigInt(ALPHABET.length);
        while (n > 0n) {
            const remainder = Number(n % base);
            result.push(ALPHABET[remainder]);
            n = n / base;
        }
    }

    // Prepend leading '1's for leading zero bytes, then reverse the digits.
    const leadingOnes = "1".repeat(zeros);
    return (leadingOnes + result.reverse().join("")) as Base58ID;
}

const CANONICAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isBase58(s: string): boolean {
    if (s.length === 0) return false;
    for (const ch of s) {
        if (!ALPHABET.includes(ch)) return false;
    }
    return true;
}

/**
 * Validate an id-shaped string (from a URL, user input, or storage) and
 * normalize it to the wire form. Accepts the short Base58 form or a canonical
 * UUID (legacy links); returns null for anything else so callers can fail
 * visibly instead of querying the API with garbage.
 */
export function toBase58ID(s: string): Base58ID | null {
    if (CANONICAL_UUID_RE.test(s)) {
        return encodeId(s);
    }
    return isBase58(s) ? (s as Base58ID) : null;
}
