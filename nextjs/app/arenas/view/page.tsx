import { ArenaView } from "./arena-view";

// /arenas/view?id=<ARENA_ID> renders a specific arena; without an id it is
// the same view as the main page (/) — the global arena. Ids travel in the
// query because a path segment per id cannot be statically exported (ADR-25).
export default function ArenaViewPage() {
    return <ArenaView />;
}
