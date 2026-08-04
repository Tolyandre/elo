import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(__dirname),
        },
    },
    test: {
        // Default to Node for the pure-logic suites. Hook/component tests opt
        // into jsdom via a `// @vitest-environment jsdom` file annotation.
        environment: "node",
    },
});
