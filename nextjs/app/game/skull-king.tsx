export const suitValues = ["jolly-roger", "chest", "parrot", "map"] as const;
export type Suit = (typeof suitValues)[number];

export const specialValues = ["skull-king", "pirate", "tigress", "mermaid", "escape", "kraken", "white-whale"] as const;

export type Special = (typeof specialValues)[number];

export type Card = { type: Suit; value: number; } |{ type: Special; };
export type ProbabilityPoints = {probability: number, points: number};

function isSuitCard(card: Card | null): card is { type: Suit; value: number; } {
    return (
        card !== null &&
        "value" in card
    );
}


export function calculateProbabilities1(numberOfPlayers: number, turnOrder: number, card: Card,
    krakenEnabled: boolean, whiteWhaleEnabled: boolean): ProbabilityPoints[] {
    if (isSuitCard(card) && card.type !== "jolly-roger") {
        
    } else {
        // расчет вероятности выиграть взятку со спецкартой
    }

    return [{probability: 1, points: 20}];
}
