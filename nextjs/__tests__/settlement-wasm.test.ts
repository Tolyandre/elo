// The wasm parity gate (ADR-38): every golden fixture the Go settlement core
// emits (pkg/settlement/golden_test.go, `make golden`) is replayed through
// the actual WebAssembly build (public/wasm/settlement.wasm + the Go
// wasm_exec.js runtime) and must reproduce the committed output exactly —
// the browser runs the same Go code, so any drift is a build or fixture bug.
//
// Requires the artifact: `make build-wasm` (locally; the CI frontend workflow
// builds it too). Without it the suite skips — the Go-side drift check in
// `make test` still verifies the fixtures themselves.
// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const wasmPath = path.join(here, "../public/wasm/settlement.wasm");
const runtimePath = path.join(here, "../public/wasm/wasm_exec.js");

type GoRuntime = { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> };
type SettlementBridge = { replayArena: (inputJson: string) => string };

declare global {
    var Go: (new () => GoRuntime) | undefined;
    var eloSettlement: SettlementBridge | undefined;
}

const fixtures = existsSync(path.join(here, "fixtures/settlement-golden.json"))
    ? (JSON.parse(readFileSync(path.join(here, "fixtures/settlement-golden.json"), "utf8")) as {
          version: number;
          cases: { name: string; input: unknown; output: unknown }[];
      })
    : { version: 0, cases: [] };

beforeAll(async () => {
    if (!existsSync(wasmPath) || !existsSync(runtimePath)) {
        console.warn("settlement.wasm missing — run `make build-wasm`; the wasm parity suite skips");
        return;
    }
    // The Go runtime is a plain script defining globalThis.Go.
    new Function(readFileSync(runtimePath, "utf8"))();
    const go = new globalThis.Go!();
    const bytes = new Uint8Array(readFileSync(wasmPath));
    const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
    // go.run resolves only when the Go program exits — and it parks forever
    // (select{}) to stay resident for the browser's later calls. Fire it and
    // wait for the bridge the entry registers instead.
    void go.run(instance);
    const deadline = Date.now() + 60_000;
    while (!globalThis.eloSettlement && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}, 120_000);

const wasmAvailable = existsSync(wasmPath) && existsSync(runtimePath);

// Numeric tolerance of the parity check. The deterministic core (vendored
// portable Exp) keeps the two targets aligned except where the platform
// compilers disagree on the last bit of some inputs (observed: 1 ULP on a
// native-vs-wasm Pow path). 1e-9 absolute is far below the displayed
// precision (ratings render as integers), so the offline values are
// display-identical to the server's; the Go-side drift check
// (pkg/settlement/golden_test.go) pins the server's exactness.
const FLOAT_EPS = 1e-9;

function expectClose(actual: unknown, expected: unknown, path: string): void {
    if (typeof actual === "number" && typeof expected === "number") {
        if (Number.isNaN(actual) && Number.isNaN(expected)) return;
        expect(Math.abs(actual - expected), path).toBeLessThanOrEqual(FLOAT_EPS);
        return;
    }
    if (Array.isArray(actual) && Array.isArray(expected)) {
        expect(actual.length, `${path}.length`).toBe(expected.length);
        actual.forEach((v, i) => expectClose(v, expected[i], `${path}[${i}]`));
        return;
    }
    if (actual && expected && typeof actual === "object" && typeof expected === "object") {
        const aKeys = Object.keys(actual as object).sort();
        const eKeys = Object.keys(expected as object).sort();
        expect(aKeys, `${path} keys`).toEqual(eKeys);
        for (const key of aKeys) {
            expectClose((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], `${path}.${key}`);
        }
        return;
    }
    expect(actual, path).toEqual(expected);
}

describe.skipIf(!wasmAvailable || fixtures.cases.length === 0)("settlement wasm golden parity (ADR-38)", () => {
    it("loads the bridge", () => {
        expect(globalThis.eloSettlement).toBeDefined();
    });

    it.each(fixtures.cases)("$name", ({ input, output }) => {
        const raw = globalThis.eloSettlement!.replayArena(JSON.stringify(input));
        const parsed = JSON.parse(raw) as { error?: string };
        expect(parsed.error).toBeUndefined();
        expectClose(parsed, output, "$");
    });
});
