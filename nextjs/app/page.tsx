import { redirect } from "next/navigation";

// The global arena is the main page (ADR-24): /arenas/view without an id
// renders it.
export default function MainPage() {
    redirect('/arenas/view');
}
