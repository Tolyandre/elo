import * as mathjs from "mathjs";

export const suitValues = ["jolly-roger", "chest", "parrot", "map"] as const;
export type Suit = (typeof suitValues)[number];

export const specialValues = ["skull-king", "pirate", "tigress", "mermaid", "escape", "kraken", "white-whale"] as const;

export type Special = (typeof specialValues)[number];

export type Card = { type: Suit; value: number; } | { type: Special; };
export type ProbabilityPoints = { probability: number, points: number };

function isSuitCard(card: Card | null): card is { type: Suit; value: number; } {
    return (
        card !== null &&
        "value" in card
    );
}

const numberOfPirates = 5; // количество пиратов в колоде
const numberOfMermaids = 2; // количество русалок в колоде
const numberOfEscapes = 5; // количество белых флагов в колоде
const numberOfSuitValues = 14; // количество значений в каждой масти

const trickMatchPoints = 20;
const trickMissPoints = -10;
const zeroTrickPoints = 10;

const suit14BonusPoints = 10;
const jollyRogerBonusPoints = 20;
const mermaidBonusPoints = 20;
const pirateBonusPoints = 30;
const skullKingBonusPoints = 40;


export function calculateProbabilities1(numberOfPlayers: number, turnOrder: number, card: Card,
    krakenEnabled: boolean, whiteWhaleEnabled: boolean): ProbabilityPoints[] {

    const probabilities: ProbabilityPoints[] = [];

    const totalCards = numberOfSuitValues * 4 + 1 /* tigress */ + numberOfPirates + numberOfMermaids + numberOfEscapes +
        + 1 /* skull-king */ + (krakenEnabled ? 1 : 0) + (whiteWhaleEnabled ? 1 : 0);

    const totalCombinations = mathjs.combinations(totalCards - 1, numberOfPlayers - 1);

    if (isSuitCard(card) && card.type !== "jolly-roger") {

        // итенация по количеству номиналов с бонусами у соперников (бонусов не более 2 других мастей)
        for (let suit14Count = 0; suit14Count <= mathjs.min(numberOfPlayers - 1, 2); suit14Count++) {
            const sute14Combinations = mathjs.combinations(2, suit14Count);

            const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 2 /* other suits */ + (card.value - 1) + numberOfEscapes;
            const safeCardsWithoutBonusCombinations = mathjs.combinations(safeCardsWithoutBonus, numberOfPlayers - 1 - suit14Count);

            const unsafeCards = totalCards - 1 /* current card */ - safeCardsWithoutBonus - 2 /* possible suit14 bonuses */;
            const unsafeCardsCombinations = mathjs.combinations(unsafeCards, 0);

            probabilities.push({
                probability: sute14Combinations * safeCardsWithoutBonusCombinations * unsafeCardsCombinations / totalCombinations,
                points: (suit14Count + (card.value === numberOfSuitValues ? 1 : 0)) * suit14BonusPoints + trickMatchPoints
            });
        }

        const winCards = numberOfSuitValues * 2 /* other suits */ + (card.value - 1) /* current suit */ + numberOfEscapes;
        const looseCards = totalCards - 1 /* current card */ - winCards;
        const winWithAnyBonusProbability = mathjs.combinations(looseCards, 0) * mathjs.combinations(winCards, numberOfPlayers - 1) / totalCombinations;

        probabilities.push({
            probability: 1 - winWithAnyBonusProbability,
            points: trickMissPoints
        });
    }
    else if (card.type === "jolly-roger") {

        // итенация по количеству номиналов с бонусами у соперников (бонусов не более 3 других мастей)
        for (let suit14Count = 0; suit14Count <= mathjs.min(numberOfPlayers - 1, 3); suit14Count++) {
            const sute14Combinations = mathjs.combinations(3, suit14Count);

            const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 3 /* other suits */ + (card.value - 1) + numberOfEscapes;
            const safeCardsWithoutBonusCombinations = mathjs.combinations(safeCardsWithoutBonus, numberOfPlayers - 1 - suit14Count);

            const unsafeCards = totalCards - 1 /* current card */ - safeCardsWithoutBonus - 2 /* possible suit14 bonuses */;
            const unsafeCardsCombinations = mathjs.combinations(unsafeCards, 0);

            probabilities.push({
                probability: sute14Combinations * safeCardsWithoutBonusCombinations * unsafeCardsCombinations / totalCombinations,
                points: suit14Count * suit14BonusPoints + (card.value === numberOfSuitValues ? jollyRogerBonusPoints : 0) + trickMatchPoints
            });
        }

        const winCards = numberOfSuitValues * 3 /* other suits */ + (card.value - 1) /* current jolly-roger suit */ + numberOfEscapes;
        const looseCards = totalCards - 1 /* current card */ - winCards;
        const winWithAnyBonusProbability = mathjs.combinations(looseCards, 0) * mathjs.combinations(winCards, numberOfPlayers - 1) / totalCombinations;

        probabilities.push({
            probability: 1 - winWithAnyBonusProbability,
            points: trickMissPoints
        });
    }
    else if (card.type === "escape") {

        if (numberOfPlayers > numberOfEscapes || turnOrder != 1) {
            probabilities.push({
                probability: 1,
                points: trickMissPoints
            });
        } else {

            const safeCards = numberOfEscapes - 1 /* current card */;
            const safeCardsCombinations = mathjs.combinations(safeCards, numberOfPlayers - 1);

            const unsafeCards = totalCards - 1 /* current card */ - safeCards;
            const unsafeCardsCombinations = mathjs.combinations(unsafeCards, 0);
            const loseOnUnsafeCardsCombinations = mathjs.combinations(unsafeCards, numberOfPlayers - 1);

            const totalCombinations = mathjs.combinations(totalCards - 1, numberOfPlayers - 1);

            probabilities.push({
                probability: safeCardsCombinations * unsafeCardsCombinations / totalCombinations,
                points: trickMatchPoints
            });

            probabilities.push({
                probability: loseOnUnsafeCardsCombinations / totalCombinations,
                points: trickMissPoints
            });
        }
    }
    else if (card.type == "kraken") {
        probabilities.push({
            probability: 1,
            points: trickMissPoints
        });
    }

    else if (card.type == "pirate") {

        // игроки перед текущим не должны сыграть опасные карты
        const looseCards = 1 /* skull-king */ + (krakenEnabled ? 1 : 0) + (whiteWhaleEnabled ? 1 : 0);
        const looseCardsBeforeCurrentTurn = looseCards + 1 /* tigress */ + numberOfPirates - 1 /* current card */;

        const notLooseBeforeCurrentTurnProbability = mathjs.combinations(looseCardsBeforeCurrentTurn, 0)
            * mathjs.combinations(totalCards - 1 /* current card */ - looseCardsBeforeCurrentTurn, turnOrder - 1)
            / mathjs.combinations(totalCards - 1, turnOrder - 1);


        // итенация по количеству номиналов с бонусами некозырной 14 у соперников (бонусов не более 3)
        for (let suit14Count = 0; suit14Count <= mathjs.min(numberOfPlayers - 1, 3); suit14Count++) {
            // итенация по количеству бонусов козырной 14 у соперников (не более 1, у соперников не может быть несколько бонусов)
            for (let jollyRoger14Count = 0; jollyRoger14Count <= mathjs.min(numberOfPlayers - 1 - suit14Count, 1); jollyRoger14Count++) {
                // итенация по количеству бонусов рукслок у соперников (не более количества русалок, у соперников не может быть несколько бонусов)
                for (let mermaidCount = 0; mermaidCount <= mathjs.min(numberOfPlayers - 1 - suit14Count - jollyRoger14Count, numberOfMermaids); mermaidCount++) {

                    const sute14Combinations = mathjs.combinations(3, suit14Count);
                    const jollyRoger14Combinations = mathjs.combinations(1, jollyRoger14Count);
                    const mermaidCombinations = mathjs.combinations(numberOfMermaids, mermaidCount);

                    const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 4
                        + mathjs.max((numberOfPirates - 1 /* current card */ + 1 /* tigress */ - turnOrder - 1), 0)
                        + numberOfEscapes;
                    const safeCardsWithoutBonusCombinations = mathjs.combinations(safeCardsWithoutBonus, numberOfPlayers - 1 
                        - suit14Count); // ??????

                    const unsafeCards = totalCards - 1 /* current card */ - safeCardsWithoutBonus - 2 /* possible suit14 bonuses */
                        - 1 /* possible jolly-roger14 bonus */ - numberOfMermaids;

                    const unsafeCardsCombinations = mathjs.combinations(unsafeCards, 0);

                    probabilities.push({
                        probability: notLooseBeforeCurrentTurnProbability * sute14Combinations * jollyRoger14Combinations * mermaidCombinations * safeCardsWithoutBonusCombinations * unsafeCardsCombinations
                            / totalCombinations,
                        points: suit14Count * suit14BonusPoints + jollyRoger14Count * jollyRogerBonusPoints
                            + mermaidCount * mermaidBonusPoints + trickMatchPoints
                    });

                }
            }
        }
    }

    return probabilities;
}
