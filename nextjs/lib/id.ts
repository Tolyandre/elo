/**
 * Short ID encoding — mirrors the backend's pkg/api/shortid package.
 *
 * UUIDs are encoded as Base58 (Bitcoin alphabet) strings, ~22 chars, with no
 * ambiguous characters (0, O, I, l omitted). The backend accepts both short and
 * canonical forms on input, so this is only needed when the client generates
 * a new id.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// Precomputed lookup: character code → index in ALPHABET (128 entries, 255 = not in alphabet).
const DECODE_MAP = new Uint8Array(128).fill(255);
for (let i = 0; i < ALPHABET.length; i++) {
    DECODE_MAP[ALPHABET.charCodeAt(i)] = i;
}

/**
 * Encode a UUID string (36-char canonical or 32-char hex) to its short Base58 form.
 */
export function encodeId(uuid: string): string {
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
    return leadingOnes + result.reverse().join("");
}
