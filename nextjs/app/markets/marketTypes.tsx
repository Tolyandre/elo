import React from "react";
import { MatchWinnerParams, Market, MarketOutcome, WinStreakParams } from "@/app/api";
import { GameListItem } from "@/app/api";
import { Player } from "@/app/api";
import { formatDateTime } from "@/lib/datetime";

export type MarketResolutionDescription = {
    /** One row per market outcome, in the market's canonical outcome order. */
    outcomes: { id: string; label: string; node: React.ReactNode }[];
    cancel: React.ReactNode;
};

type GetPlayerName = (player: Player) => string;

interface MarketTypeStrategy {
    getTitle(market: Market, players: Player[], games: GameListItem[], getPlayerName: GetPlayerName): string;
    getResolutionDescription(market: Market, players: Player[], games: GameListItem[], getPlayerName: GetPlayerName): MarketResolutionDescription;
}

const H = ({ children }: { children: React.ReactNode }) => (
    // <span className="font-medium text-foreground">{children}</span>
    <>{children}</>
);

function buildPeriodNode(market: Market): React.ReactNode | null {
    const startsAt = market.starts_at ? formatDateTime(market.starts_at) : null;
    const closesAt = market.closes_at ? formatDateTime(market.closes_at) : null;
    if (startsAt && closesAt) return <>с <H>{startsAt}</H> по <H>{closesAt}</H></>;
    if (closesAt) return <>до <H>{closesAt}</H></>;
    return null;
}

// outcomeLabel resolves the display label of an outcome, preferring the local
// player context (club icons etc. are rendered by the caller via player_id);
// the API-derived name is the fallback.
export function outcomeDisplayName(outcome: MarketOutcome, players: Player[], getPlayerName: GetPlayerName): string {
    if (outcome.kind === "player" && outcome.player_id) {
        const found = players.find((p) => p.id === outcome.player_id);
        if (found) return getPlayerName(found);
    }
    return outcome.name;
}

const matchWinnerStrategy: MarketTypeStrategy = {
    getTitle(market, players, games, getPlayerName) {
        const params = market.params as MatchWinnerParams | null;
        const targetNames = (params?.target_player_ids ?? [])
            .map((id) => {
                const p = players.find((p) => p.id === id);
                return p ? getPlayerName(p) : "?";
            })
            .join(", ");
        const gameNames = (params?.game_ids ?? [])
            .map((id) => games.find((g) => g.id === id)?.name)
            .filter(Boolean) as string[];
        let title = targetNames ? `Кто победит` : `Победитель`;
        if (gameNames.length === 1) title += ` в ${gameNames[0]}`;
        else if (gameNames.length > 1) title += ` в ${gameNames.join(" / ")}`;
        else title += ` в партии`;

        if (targetNames) title += ` с участием ${targetNames}`;
        return title;
    },
    getResolutionDescription(market, players, games, getPlayerName) {
        const params = market.params as MatchWinnerParams | null;
        const gameNames = (params?.game_ids ?? []).map((id) => games.find((g) => g.id === id)?.name ?? "?");
        const period = buildPeriodNode(market);
        const allowOther = params?.allow_other_players ?? true;

        const targetNames = (params?.target_player_ids ?? [])
            .map((id) => {
                const p = players.find((p) => p.id === id);
                return p ? getPlayerName(p) : "?";
            });

        const gameNode = gameNames.length > 0 ? <> в <H>{gameNames.join(" / ")}</H></> : null;
        const vsNode = allowOther
            ? <> в партии с участием <H>{targetNames.join(", ")}</H> (и возможно другими игроками)</>
            : <> в партии с участием ровно <H>{targetNames.join(", ")}</H></>;
        const periodNode = period ? <> в период {period}</> : null;

        return {
            outcomes: market.outcomes.map((o) => {
                if (o.kind === "player" && o.player_id) {
                    const name = outcomeDisplayName(o, players, getPlayerName);
                    return {
                        id: o.id,
                        label: name,
                        node: <><H>{name}</H> единолично занимает первое место{vsNode}{gameNode}{periodNode}</>,
                    };
                }
                return {
                    id: o.id,
                    label: "Ничья",
                    node: allowOther
                        ? <>Ничья (первое место делят два и более игроков) или победа постороннего игрока{vsNode}{gameNode}{periodNode}</>
                        : <>Ничья — первое место делят два и более игроков{vsNode}{gameNode}{periodNode}</>,
                };
            }),
            cancel: period
                ? <>Партия с участием <H>{targetNames.join(", ")}</H>{gameNode} не сыграна в период {period}</>
                : <>Партия с участием <H>{targetNames.join(", ")}</H>{gameNode} не сыграна</>,
        };
    },
};

const winStreakStrategy: MarketTypeStrategy = {
    getTitle(market, players, games, getPlayerName) {
        const params = market.params as WinStreakParams | null;
        const found = players.find((p) => p.id === params?.target_player_id);
        const targetName = found ? getPlayerName(found) : "?";
        const gameNames = (params?.game_ids ?? [])
            .map((id) => games.find((g) => g.id === id)?.name)
            .filter(Boolean) as string[];
        const wins = params?.wins_required ?? "?";
        const inGame = gameNames.length === 1 ? ` в ${gameNames[0]}` : gameNames.length > 1 ? ` в ${gameNames.join(" / ")}` : "";
        let title = `${targetName} победит${inGame} ${wins} ${pluralizeRaz(params?.wins_required ?? 0)}`;
        if (params?.max_losses != null) {
            title += `, не проиграв более ${params.max_losses} раз`;
        }
        return title;
    },
    getResolutionDescription(market, players, games, getPlayerName) {
        const params = market.params as WinStreakParams | null;
        const found = players.find((p) => p.id === params?.target_player_id);
        const targetName = found ? getPlayerName(found) : "?";
        const gameNames = (params?.game_ids ?? []).map((id) => games.find((g) => g.id === id)?.name ?? "?");
        const wins = params?.wins_required ?? "?";
        const lossLimit = params?.max_losses;
        const period = buildPeriodNode(market);

        const inGameNode = gameNames.length > 0 ? <> в <H>{gameNames.join(" / ")}</H></> : null;
        const periodNode = period ? <> в период {period}</> : null;
        const lossNode = lossLimit != null ? <>, допустив не более <H>{lossLimit}</H> поражений</> : null;

        const yesNode = <><H>{targetName}</H> одерживает <H>{wins}</H> побед{inGameNode}{lossNode}{periodNode}</>;
        const noNode = lossLimit != null
            ? <><H>{targetName}</H> не одерживает <H>{wins}</H> побед{inGameNode}{periodNode}, либо допускает более <H>{lossLimit}</H> поражений</>
            : <><H>{targetName}</H> не одерживает <H>{wins}</H> побед{inGameNode}{periodNode}</>;

        const label = (kind: "yes" | "no") => (kind === "yes" ? "Да" : "Нет");
        return {
            outcomes: market.outcomes.map((o) => ({
                id: o.id,
                label: o.name || label(o.kind === "yes" ? "yes" : "no"),
                node: o.kind === "yes" ? yesNode : noNode,
            })),
            cancel: "Автоматических условий нет — рынок всегда разрешается в Да или Нет",
        };
    },
};

function pluralizeRaz(n: number): string {
    const mod100 = n % 100;
    const mod10 = n % 10;
    if (mod100 >= 11 && mod100 <= 19) return "раз";
    if (mod10 === 1) return "раз";
    if (mod10 >= 2 && mod10 <= 4) return "раза";
    return "раз";
}

const marketTypeRegistry: Record<string, MarketTypeStrategy> = {
    match_winner: matchWinnerStrategy,
    win_streak: winStreakStrategy,
};

export function getMarketTitle(
    market: Market,
    players: Player[],
    games: GameListItem[],
    getPlayerName: GetPlayerName = (p) => p.name,
): string {
    return marketTypeRegistry[market.market_type]?.getTitle(market, players, games, getPlayerName) ?? market.market_type;
}

export function getMarketResolutionDescription(
    market: Market,
    players: Player[],
    games: GameListItem[],
    getPlayerName: GetPlayerName = (p) => p.name,
): MarketResolutionDescription {
    return marketTypeRegistry[market.market_type]?.getResolutionDescription(market, players, games, getPlayerName)
        ?? { outcomes: [], cancel: "" };
}
