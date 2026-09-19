"use client";

import { Fragment, useMemo, useRef } from "react";
import type { PlanRound, TournamentPlan } from "@/app/api";
import { roundTitle, trackLabel } from "./labels";
import { groupByTrack, offsetSpacers, roundColumnOffsets } from "./bracket-structure";
import { ConnectorLayer, useConnectorPaths, type ConnectorSpec } from "@/components/bracket/bracket-connector";

/**
 * Visual mockup of a bracket plan (ADR-26 §UI): the shape the organizer is
 * about to commit to — a column per round with seat dots per table and a
 * line per promotion, losers rounds offset a column right of the winners
 * round they run alongside. Pure rendering of the plan document.
 */
export function PlanBracketPreview({ plan }: { plan: TournamentPlan }) {
    const contentRef = useRef<HTMLDivElement>(null);

    const bands = useMemo(() => groupByTrack(plan.rounds), [plan.rounds]);
    const finalBand = bands.find((b) => b.track === "final");
    const trackBands = bands.filter((b) => b.track !== "final");

    // Plan seats reference their source by the flat slot index (slots
    // numbered in canonical round order); resolve it to a per-round node id.
    const connections = useMemo<ConnectorSpec[]>(() => {
        const nodeIds: string[][] = plan.rounds.map((round) => round.slots.map((_, si) => `plan-${round.track}-${round.index}-${si}`));
        const flat: string[] = nodeIds.flat();
        const specs: ConnectorSpec[] = [];
        plan.rounds.forEach((round, ri) => {
            round.slots.forEach((slot, si) => {
                slot.seats.forEach((seat, seatIdx) => {
                    if (seat.kind !== "source" || seat.source_slot == null) return;
                    const sourceId = flat[seat.source_slot];
                    if (!sourceId) return;
                    specs.push({
                        key: `${ri}-${si}-${seatIdx}`,
                        from: { slotId: sourceId },
                        to: { slotId: nodeIds[ri][si], seatPosition: seatIdx + 1 },
                    });
                });
            });
        });
        return specs;
    }, [plan]);

    // The double-elim interleave (see roundColumnOffsets): a losers round
    // renders under the winners round it runs alongside. Offsets are global
    // column positions; spacer counts are derived per band, because every
    // band's row starts at column 0.
    const roundOffsets = useMemo(() => {
        const flatRound: PlanRound[] = [];
        for (const round of plan.rounds) {
            for (let i = 0; i < round.slots.length; i++) flatRound.push(round);
        }
        const winnersSource = (round: PlanRound): number => {
            let max = 0;
            for (const slot of round.slots) {
                for (const seat of slot.seats) {
                    const src = seat.kind === "source" && seat.source_slot != null
                        ? flatRound[seat.source_slot]
                        : undefined;
                    if (src?.track === "winners") max = Math.max(max, src.index);
                }
            }
            return max;
        };
        const byRound = new Map<string, number>();
        roundColumnOffsets(plan.rounds, winnersSource).forEach((offset, i) => {
            const round = plan.rounds[i];
            byRound.set(`${round.track}-${round.index}`, offset);
        });
        return byRound;
    }, [plan]);

    const paths = useConnectorPaths(contentRef, connections);

    const roundColumns = (rounds: TournamentPlan["rounds"]) => {
        const spacers = offsetSpacers(rounds.map((r) => roundOffsets.get(`${r.track}-${r.index}`) ?? 0));
        return rounds.map((round, ri) => (
            <Fragment key={`${round.track}-${round.index}`}>
                {Array.from({ length: spacers[ri] }, (_, i) => (
                    <div key={i} aria-hidden className="w-16 shrink-0" />
                ))}
                <PlanRoundColumn plan={plan} round={round} />
            </Fragment>
        ));
    };

    // The final band follows the tracks grid as a whole — its rounds sit
    // consecutive, no interleave spacers.
    const finalColumns = (rounds: TournamentPlan["rounds"]) =>
        rounds.map((round) => (
            <PlanRoundColumn key={`${round.track}-${round.index}`} plan={plan} round={round} />
        ));

    return (
        <div className="overflow-x-auto">
            <div ref={contentRef} className="relative flex min-w-max items-stretch gap-5">
                <ConnectorLayer paths={paths} />
                <div className="flex flex-col gap-8">
                    {trackBands.map(({ track, rounds }) => (
                        <section key={track} className="flex flex-col gap-2">
                            {trackBands.length > 1 && (
                                <h4 className="text-xs font-semibold text-muted-foreground">{trackLabel(track)}</h4>
                            )}
                            <div className="flex flex-1 items-stretch gap-5">
                                {roundColumns(rounds)}
                            </div>
                        </section>
                    ))}
                </div>
                {finalBand && (
                    <section className="flex flex-col gap-2">
                        <div className="flex flex-1 items-stretch gap-5">
                            {finalColumns(finalBand.rounds)}
                        </div>
                    </section>
                )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
                Кружки — места за столом (пунктир — бай), линии — переходы между столами,
                <span className="whitespace-nowrap"> → N — сколько проходит дальше.</span>
            </p>
        </div>
    );
}

function PlanRoundColumn({ plan, round }: { plan: TournamentPlan; round: TournamentPlan["rounds"][number] }) {
    return (
        <div className="flex w-16 flex-col">
            <h4 className="mb-2 text-center text-xs font-medium text-muted-foreground">
                {roundTitle(round.track, round.index, plan.elimination)}
                <span className="whitespace-nowrap"> → {round.promote}</span>
            </h4>
            <div className="flex flex-1 flex-col justify-around gap-3">
                {round.slots.map((slot, si) => (
                    <div
                        key={si}
                        data-bracket-slot={`plan-${round.track}-${round.index}-${si}`}
                        className="w-16 rounded-lg border bg-card px-2 py-1.5 space-y-1"
                    >
                        {slot.seats.map((seat, seatIdx) => (
                            <div key={seatIdx} data-bracket-seat={seatIdx + 1} className="flex items-center">
                                <span
                                    className={`h-1.5 w-1.5 rounded-full ${
                                        seat.kind === "bye"
                                            ? "border border-dashed border-muted-foreground/60"
                                            : "bg-muted-foreground/40"
                                    }`}
                                />
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}
