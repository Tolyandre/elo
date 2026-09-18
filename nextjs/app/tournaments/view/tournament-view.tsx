"use client";

import { useState } from "react";
import Link from "next/link";
import { Edit2, Trophy } from "lucide-react";
import { toBase58ID, type Base58ID } from "@/lib/id";
import { useUrlQuery, setUrlQuery } from "@/lib/url-state";
import {
    getTournamentBracketPromise,
    getTournamentPromise,
    registerInTournamentPromise,
    unregisterFromTournamentPromise,
} from "@/app/api";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useMe } from "@/app/meContext";
import { usePlayers } from "@/app/players/PlayersContext";
import { useTournaments } from "../tournamentsContext";
import { eliminationLabel, tournamentStatusLabel } from "../labels";
import { BracketView } from "./bracket-view";
import { TournamentArenaStandings } from "./arena-standings";
import { BackButton } from "@/components/back-button";
import { ErrorAlert } from "@/components/error-alert";
import { PageHeader } from "@/app/pageHeaderContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTimeLong } from "@/lib/datetime";

const TOURNAMENT_TABS = ["tournament", "arena"] as const;

function parseTab(value: string | null): string {
    return (TOURNAMENT_TABS as readonly string[]).includes(value ?? "") ? (value as string) : "tournament";
}

/**
 * The tournament page (ADR-26 §UI): header with status/elimination/deadline,
 * the champion banner when completed, registration with the self-service
 * button, the bracket once started, and the arena standings embed.
 */
export function TournamentView() {
    const params = useUrlQuery();
    const id = toBase58ID(params.get("id") ?? "");
    const tab = parseTab(params.get("tab"));

    const { data, loading, error, invalidate } = useAsyncResource(async () => {
        if (!id) return null;
        const tournament = await getTournamentPromise(id);
        const bracket = await getTournamentBracketPromise(id);
        return { tournament, bracket };
    }, [id]);

    if (!id) {
        return (
            <main className="max-w-sm mx-auto space-y-4">
                <BackButton href="/tournaments" label="Назад к турнирам" />
                <p className="text-muted-foreground">Турнир не найден — проверьте ссылку.</p>
            </main>
        );
    }

    function setTab(value: string) {
        setUrlQuery((params) => params.set("tab", value), "push");
    }

    return (
        <main className="max-w-sm mx-auto space-y-4">
            <BackButton href="/tournaments" label="Назад к турнирам" />
            {error && <ErrorAlert message={error} />}
            {loading && (
                <div className="space-y-2">
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="h-48 w-full rounded-xl" />
                </div>
            )}
            {data && (
                <TournamentViewLoaded
                    tournamentId={id}
                    tournament={data.tournament}
                    bracket={data.bracket}
                    invalidate={invalidate}
                    tab={tab}
                    setTab={setTab}
                />
            )}
        </main>
    );
}

function TournamentViewLoaded({
    tournamentId,
    tournament,
    bracket,
    invalidate,
    tab,
    setTab,
}: {
    tournamentId: Base58ID;
    tournament: Awaited<ReturnType<typeof getTournamentPromise>>;
    bracket: Awaited<ReturnType<typeof getTournamentBracketPromise>>;
    invalidate: () => void;
    tab: string;
    setTab: (value: string) => void;
}) {
    const { canEdit, playerId } = useMe();
    const { playerMap, playerDisplayName } = usePlayers();
    const { invalidate: invalidateTournaments } = useTournaments();
    const [registering, setRegistering] = useState(false);

    const playerName = (pid: string): string => {
        const player = playerMap.get(pid);
        return player ? playerDisplayName(player) : pid;
    };
    const participants = tournament.participant_ids ?? [];
    const registered = playerId != null && participants.includes(playerId);
    const winnerId = bracket.winner_player_id ?? tournament.winner_player_id ?? null;

    async function handleRegistration(withdraw: boolean) {
        setRegistering(true);
        try {
            if (withdraw) {
                await unregisterFromTournamentPromise(tournamentId);
            } else {
                await registerInTournamentPromise(tournamentId);
            }
            invalidate();
            invalidateTournaments();
        } finally {
            setRegistering(false);
        }
    }

    return (
        <>
            <PageHeader
                title={tournament.name}
                action={canEdit ? (
                    <Button asChild size="sm" variant="outline" aria-label="Управление турниром">
                        <Link href={`/tournaments/edit?id=${tournament.id}`}>
                            <Edit2 className="h-4 w-4" />
                        </Link>
                    </Button>
                ) : undefined}
            />

            <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{tournamentStatusLabel(tournament.status)}</Badge>
                <span className="text-muted-foreground">{eliminationLabel(tournament.elimination)}</span>
                {tournament.grand_final_deadline && (
                    <span className="text-muted-foreground">
                        Дедлайн финала: {formatDateTimeLong(tournament.grand_final_deadline)}
                    </span>
                )}
            </div>

            {winnerId && (
                <Card className="border-amber-400/60">
                    <CardContent className="flex items-center gap-2 py-3">
                        <Trophy className="h-5 w-5 text-amber-500 shrink-0" />
                        <span>
                            Победитель:{" "}
                            <Link href={`/players/view?id=${winnerId}`} className="font-semibold underline">
                                {playerName(winnerId)}
                            </Link>
                        </span>
                    </CardContent>
                </Card>
            )}

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="tournament" className="px-1 text-xs">Турнир</TabsTrigger>
                    <TabsTrigger value="arena" className="px-1 text-xs">Рейтинг</TabsTrigger>
                </TabsList>

                <TabsContent value="tournament" className="space-y-4">
                    {tournament.status === "registration" && (
                        <RegistrationSection
                            participants={participants}
                            playerName={playerName}
                            showRegistrationButton={playerId != null}
                            registered={registered}
                            registering={registering}
                            onRegistration={handleRegistration}
                        />
                    )}
                    {bracket.rounds.length > 0 ? (
                        <BracketView bracket={bracket} />
                    ) : (
                        tournament.status === "registration" && (
                            <p className="text-sm text-muted-foreground">
                                Сетка появится после жеребьёвки — организатор выбирает форму и начинает турнир.
                            </p>
                        )
                    )}
                </TabsContent>

                <TabsContent value="arena">
                    <TournamentArenaStandings tournamentId={tournamentId} />
                </TabsContent>
            </Tabs>
        </>
    );
}

function RegistrationSection({
    participants,
    playerName,
    showRegistrationButton,
    registered,
    registering,
    onRegistration,
}: {
    participants: string[];
    playerName: (pid: string) => string;
    showRegistrationButton: boolean;
    registered: boolean;
    registering: boolean;
    onRegistration: (withdraw: boolean) => void;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">
                    Участники: {participants.length}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {participants.length > 0 ? (
                    <ul className="space-y-1 text-sm">
                        {participants.map((pid) => (
                            <li key={pid}>
                                <Link href={`/players/view?id=${pid}`} className="underline">{playerName(pid)}</Link>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-muted-foreground">Пока никто не записался</p>
                )}
                {showRegistrationButton && (
                    <Button
                        size="sm"
                        variant={registered ? "outline" : "default"}
                        disabled={registering}
                        onClick={() => onRegistration(registered)}
                    >
                        {registered ? "Сняться с турнира" : "Записаться"}
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}
