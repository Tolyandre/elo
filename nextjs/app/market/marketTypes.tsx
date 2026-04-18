import React from "react";
import { MatchWinnerParams, Market, WinStreakParams } from "@/app/api";
import { GameListItem } from "@/app/api";
import { Player } from "@/app/api";

export type MarketResolutionDescription = {
    yes: React.ReactNode;
    no: React.ReactNode;
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

const fmt = (d: string) => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function buildPeriodNode(market: Market): React.ReactNode | null {
    const startsAt = market.starts_at ? fmt(market.starts_at) : null;
    const closesAt = market.closes_at ? fmt(market.closes_at) : null;
    if (startsAt && closesAt) return <>с <H>{startsAt}</H> по <H>{closesAt}</H></>;
    if (closesAt) return <>до <H>{closesAt}</H></>;
    return null;
}

const matchWinnerStrategy: MarketTypeStrategy = {
    getTitle(market, players, games, getPlayerName) {
        const params = market.params as MatchWinnerParams | null;
        const found = players.find((p) => p.id === market.target_player_id);
        const targetName = found ? getPlayerName(found) : "?";
        const requiredNames = (params?.required_player_ids ?? [])
            .map((id) => { const p = players.find((p) => p.id === id); return p ? getPlayerName(p) : "?"; })
            .join(", ");
        const gameNames = (params?.game_ids ?? [])
            .map((id) => games.find((g) => g.id === id)?.name)
            .filter(Boolean) as string[];
        let title = `${targetName} победит`;
        if (gameNames.length === 1) title += ` в ${gameNames[0]}`;
        else if (gameNames.length > 1) title += ` в ${gameNames.join(" / ")}`;
        if (requiredNames) title += gameNames.length > 0 ? ` с участием ${requiredNames}` : ` в партии с участием ${requiredNames}`;
        return title;
    },
    getResolutionDescription(market, players, games, getPlayerName) {
        const params = market.params as MatchWinnerParams | null;
        const foundTarget = players.find((p) => p.id === market.target_player_id);
        const targetName = foundTarget ? getPlayerName(foundTarget) : "?";
        const requiredPlayerNames = (params?.required_player_ids ?? [])
            .map((id) => { const p = players.find((p) => p.id === id); return p ? getPlayerName(p) : "?"; });
        const allNames = [targetName, ...requiredPlayerNames];
        const gameNames = (params?.game_ids ?? []).map((id) => games.find((g) => g.id === id)?.name ?? "?");
        const period = buildPeriodNode(market);

        const vsNode = requiredPlayerNames.length > 0
            ? <> в партии с <H>{requiredPlayerNames.join(", ")}</H> (и возможно другими игроками)</>
            : <> в партии с любым составом</>;
        const inGameNode = gameNames.length > 0 ? <> в <H>{gameNames.join(" / ")}</H></> : null;

        return {
            yes: <><H>{targetName}</H> занимает первое место{vsNode}{inGameNode}</>,
            no: <><H>{targetName}</H> не занимает первое место{vsNode}{inGameNode}</>,
            cancel: period
                ? <>Партия с участием <H>{allNames.join(", ")}</H>{inGameNode} не сыграна в период {period}</>
                : <>Партия с участием <H>{allNames.join(", ")}</H>{inGameNode} не сыграна</>,
        };
    },
};

const winStreakStrategy: MarketTypeStrategy = {
    getTitle(market, players, games, getPlayerName) {
        const params = market.params as WinStreakParams | null;
        const found = players.find((p) => p.id === market.target_player_id);
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
        const found = players.find((p) => p.id === market.target_player_id);
        const targetName = found ? getPlayerName(found) : "?";
        const gameNames = (params?.game_ids ?? []).map((id) => games.find((g) => g.id === id)?.name ?? "?");
        const wins = params?.wins_required ?? "?";
        const lossLimit = params?.max_losses;
        const period = buildPeriodNode(market);

        const inGameNode = gameNames.length > 0 ? <> в <H>{gameNames.join(" / ")}</H></> : null;
        const periodNode = period ? <> в период {period}</> : null;
        const lossNode = lossLimit != null ? <>, допустив не более <H>{lossLimit}</H> поражений</> : null;

        return {
            yes: <><H>{targetName}</H> одерживает <H>{wins}</H> побед{inGameNode}{lossNode}{periodNode}</>,
            no: lossLimit != null
                ? <><H>{targetName}</H> не одерживает <H>{wins}</H> побед{inGameNode}{periodNode}, либо допускает более <H>{lossLimit}</H> поражений</>
                : <><H>{targetName}</H> не одерживает <H>{wins}</H> побед{inGameNode}{periodNode}</>,
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
        ?? { yes: "", no: "", cancel: "" };
}
