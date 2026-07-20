import React from "react";
import { VictoryPoints } from "./victory-points";

/**
 * ScoringBadge — scoring rule from "It's a Wonderful World".
 * Composed from VictoryPoints + × + icon(s).
 *
 *   <ScoringBadge vp={2} icon={<ProjectIcon />} />
 *   <ScoringBadge vp={1} icon={<GeneralToken />} icon2={<FinancierToken />} />
 */
export function ScoringBadge({
    vp,
    icon,
    icon2,
}: {
    vp: number;
    icon: React.ReactNode;
    /** Second icon for set-scoring (score per pair of different resources) */
    icon2?: React.ReactNode;
}) {
    return (
        <span className="inline-flex items-center gap-1">
            <VictoryPoints value={vp} />
            <span className="font-bold text-amber-700">×</span>
            <span className="inline-flex items-center gap-0">
                <span style={{ display: "inline-flex", width: "2.4em", height: "2.4em" }}>{icon}</span>
                {icon2 && <span style={{ display: "inline-flex", width: "2.4em", height: "2.4em" }}>{icon2}</span>}
            </span>
        </span>
    );
}
