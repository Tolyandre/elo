import { describe, expect, it } from 'vitest';
import { encodeId } from '../lib/id';

describe('encodeId', () => {
    it('encodes a canonical UUID to a short Base58 string', () => {
        const short = encodeId('018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f');
        expect(short.length).toBeLessThanOrEqual(22);
        expect(short).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/); // no 0, O, I, l
    });

    it('round-trips with the Go backend (same algorithm)', () => {
        const uuids = [
            '018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f',
            '00000000-0000-0000-0000-000000000001', // legacy int-backed
            '00000000-0000-0000-0000-000000000000', // nil UUID
            'ffffffff-ffff-ffff-ffff-ffffffffffff', // max
        ];
        for (const uuid of uuids) {
            const short = encodeId(uuid);
            expect(short).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
            expect(short.length).toBeLessThanOrEqual(22);
        }
    });

    it('encodes without dashes too', () => {
        const withDashes = '018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f';
        const withoutDashes = '018f6b483e0b7c3f8d2b0a1b2c3d4e5f';
        expect(encodeId(withDashes)).toBe(encodeId(withoutDashes));
    });

    it('throws on invalid input', () => {
        expect(() => encodeId('')).toThrow();
        expect(() => encodeId('not-a-uuid')).toThrow();
        expect(() => encodeId('018f6b48-3e0b-7c3f')).toThrow();
    });

    it('produces URL-safe strings (no special characters)', () => {
        const short = encodeId('018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f');
        expect(encodeURIComponent(short)).toBe(short);
    });
});
