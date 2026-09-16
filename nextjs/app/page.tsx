import { ArenaView } from "@/app/arenas/view/arena-view";

// The global arena is the main page (ADR-24, ADR-25): the arena view renders
// here directly, without an id. It must not be a redirect() page — a
// statically exported redirect is an empty shell with a client-side replay,
// which made every visit to / (and every PWA launch — the manifest start_url
// is /) blink through an extra hop.
export default function MainPage() {
    return <ArenaView />;
}
