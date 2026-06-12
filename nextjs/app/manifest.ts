import type { MetadataRoute } from "next";

// Required for `output: "export"` — the manifest is generated at build time.
export const dynamic = "force-static";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Board Games Elo",
        short_name: "Elo",
        description: "Отслеживайте Elo-рейтинг игроков в настольных играх.",
        start_url: `${basePath}/`,
        scope: `${basePath}/`,
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#166534",
        icons: [
            { src: `${basePath}/icon-192.png`, sizes: "192x192", type: "image/png" },
            { src: `${basePath}/icon-512.png`, sizes: "512x512", type: "image/png" },
            { src: `${basePath}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
    };
}
