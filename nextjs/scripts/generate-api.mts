/**
 * Generate app/api-types.gen.ts from ../openapi/openapi.yaml.
 *
 * A drop-in replacement for the openapi-typescript CLI that brands the shared
 * Base58ID schema as lib/id.ts's Base58ID type, so every id field in the
 * generated types is compile-time distinct from a plain string (ADR-12).
 * The CLI has no hook for custom types; the Node API's transform() does.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const input = path.join(here, "..", "..", "openapi", "openapi.yaml");
const output = path.join(here, "..", "app", "api-types.gen.ts");

const BASE58_ID = ts.factory.createTypeReferenceNode(
    ts.factory.createIdentifier("Base58ID"),
);

const ast = await openapiTS(new URL(`file://${input}`), {
    transform(schemaObject, metadata) {
        if (metadata.path === "#/components/schemas/Base58ID") {
            return BASE58_ID;
        }
    },
});

let contents = astToString(ast);
// The transform can reference our type but cannot add imports; splice one in.
contents = `import type { Base58ID } from "../lib/id";\n\n` + contents;

fs.writeFileSync(output, contents);
console.log(`openapi-typescript (branded ids) → ${path.relative(process.cwd(), output)}`);
