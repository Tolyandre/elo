import * as mathjs from "mathjs";
import { Fraction } from "mathjs";

export const suitValues = ["jolly-roger", "chest", "parrot", "map"] as const;
export type Suit = (typeof suitValues)[number];

export const specialValues = ["skull-king", "pirate", "tigress", "mermaid", "escape", "kraken", "white-whale"] as const;

export type Special = (typeof specialValues)[number];

export type Card = { type: Suit; value: number; } | { type: Special; };
export type ProbabilityPoints = { probability: Fraction, points: number };

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

const bidMatchPoints = 20;
const bidMissPoints = -10;
const zeroBidPoints = 10;

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
                probability: new Fraction(sute14Combinations * safeCardsWithoutBonusCombinations * unsafeCardsCombinations, totalCombinations),
                points: (suit14Count + (card.value === numberOfSuitValues ? 1 : 0)) * suit14BonusPoints + bidMatchPoints
            });
        }

        const winCards = numberOfSuitValues * 2 /* other suits */ + (card.value - 1) /* current suit */ + numberOfEscapes;
        const looseCards = totalCards - 1 /* current card */ - winCards;
        const winWithAnyBonusProbability = new Fraction(mathjs.combinations(looseCards, 0) * mathjs.combinations(winCards, numberOfPlayers - 1), totalCombinations);

        probabilities.push({
            probability: new Fraction(1).sub(winWithAnyBonusProbability),
            points: bidMissPoints
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
                probability: new Fraction(sute14Combinations * safeCardsWithoutBonusCombinations * unsafeCardsCombinations, totalCombinations),
                points: suit14Count * suit14BonusPoints + (card.value === numberOfSuitValues ? jollyRogerBonusPoints : 0) + bidMatchPoints
            });
        }

        const winCards = numberOfSuitValues * 3 /* other suits */ + (card.value - 1) /* current jolly-roger suit */ + numberOfEscapes;
        const looseCards = totalCards - 1 /* current card */ - winCards;
        const winWithAnyBonusProbability = mathjs.combinations(looseCards, 0) * mathjs.combinations(winCards, numberOfPlayers - 1) / totalCombinations;

        probabilities.push({
            probability: new Fraction(1).sub(winWithAnyBonusProbability),
            points: bidMissPoints
        });
    }
    else if (card.type === "escape") {

        if (numberOfPlayers > numberOfEscapes || turnOrder != 1) {
            probabilities.push({
                probability: new Fraction(1),
                points: bidMissPoints
            });
        } else {

            const safeCards = numberOfEscapes - 1 /* current card */;
            const safeCardsCombinations = mathjs.combinations(safeCards, numberOfPlayers - 1);

            const unsafeCards = totalCards - 1 /* current card */ - safeCards;
            const unsafeCardsCombinations = mathjs.combinations(unsafeCards, 0);
            const loseOnUnsafeCardsCombinations = mathjs.combinations(unsafeCards, numberOfPlayers - 1);

            const totalCombinations = mathjs.combinations(totalCards - 1, numberOfPlayers - 1);

            probabilities.push({
                probability: new Fraction(safeCardsCombinations * unsafeCardsCombinations, totalCombinations),
                points: bidMatchPoints
            });

            probabilities.push({
                probability: new Fraction(loseOnUnsafeCardsCombinations, totalCombinations),
                points: bidMissPoints
            });
        }
    }
    else if (card.type == "kraken") {
        probabilities.push({
            probability: new Fraction(1),
            points: bidMissPoints
        });
    }

    else if (card.type == "pirate") {

        const otherPirateCards = (numberOfPirates + 1 /* tigress */) - 1/* current card */;

        // итерация по количеству номиналов с бонусами некозырной 14 у соперников (бонусов не более 3)
        for (let suit14Count = 0; suit14Count <= mathjs.min(numberOfPlayers - 1, 3); suit14Count++) {
            // итерация по количеству бонусов козырной 14 у соперников (не более 1, в пределах количества соперников)
            for (let jollyRoger14Count = 0; jollyRoger14Count <= mathjs.min(numberOfPlayers - 1 - suit14Count, 1); jollyRoger14Count++) {
                // итерация по количеству бонусов русалок у соперников (не более количества русалок, в пределах количества соперников)
                for (let mermaidCount = 0; mermaidCount <= mathjs.min(numberOfPlayers - 1 - suit14Count - jollyRoger14Count, numberOfMermaids); mermaidCount++) {
                    // итерация по количеству карт с пиратами или tigress у соперников
                    // (не более количества пиратов минус текущая карта, в пределах количества соперников)
                    for (let pirateCount = 0; pirateCount <= mathjs.min(numberOfPlayers - 1 - suit14Count - jollyRoger14Count - mermaidCount, otherPirateCards); pirateCount++) {

                        const sute14Combinations = mathjs.combinations(3, suit14Count);
                        const jollyRoger14Combinations = mathjs.combinations(1, jollyRoger14Count);
                        const mermaidCombinations = mathjs.combinations(numberOfMermaids, mermaidCount);
                        const pirateCombinations = mathjs.combinations(otherPirateCards, pirateCount);

                        const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 4
                            + numberOfEscapes;
                        const safeCardsWithoutBonusCombinations = mathjs.combinations(safeCardsWithoutBonus, numberOfPlayers - 1
                            - suit14Count - jollyRoger14Count - mermaidCount - pirateCount);

                        const unsafeCards = totalCards - 1 /* current card */ - safeCardsWithoutBonus - 3 /* possible suit14 bonuses */
                            - 1 /* possible jolly-roger14 bonus */ - numberOfMermaids;
                        const unsafeCardsCombinations = mathjs.combinations(unsafeCards, 0);

                        // на numberOfPlayers-1 игроков вышло pirateCount пиратов
                        // определяем вероятность, что карта пиратов вышла не перед текущим ходом
                        const notLooseBeforeCurrentTurnProbability = (turnOrder - 1 > numberOfPlayers - 1 - pirateCount)
                            ? new Fraction(0)
                            : new Fraction(mathjs.combinations(numberOfPlayers - 1 - pirateCount, turnOrder - 1),
                                mathjs.combinations(numberOfPlayers - 1, turnOrder - 1));

                        const combinations = sute14Combinations * jollyRoger14Combinations * mermaidCombinations * pirateCombinations * safeCardsWithoutBonusCombinations * unsafeCardsCombinations;
                        probabilities.push({
                            probability: notLooseBeforeCurrentTurnProbability.mul(new Fraction(combinations, totalCombinations)),
                            points: suit14Count * suit14BonusPoints + jollyRoger14Count * jollyRogerBonusPoints
                                + mermaidCount * mermaidBonusPoints + bidMatchPoints
                        });

                        probabilities.push({
                            probability: new Fraction(1).sub(notLooseBeforeCurrentTurnProbability).mul(combinations).div(totalCombinations),
                            points: bidMissPoints
                        });

                    }
                }
            }
        }

        const winCards = numberOfSuitValues * 4 /* suits */ + numberOfEscapes + numberOfMermaids + otherPirateCards;
        const looseCards = 1 /* skull-king */ + (krakenEnabled ? 1 : 0) + (whiteWhaleEnabled ? 1 : 0);
        const winWithAnyBonusProbability = mathjs.combinations(looseCards, 0) * mathjs.combinations(winCards, numberOfPlayers - 1) / totalCombinations;

        probabilities.push({
            probability: new Fraction(1).sub(winWithAnyBonusProbability),
            points: bidMissPoints
        });

        // // игроки перед текущим не должны сыграть пиратов
        // const looseCards = 1 /* skull-king */ + (krakenEnabled ? 1 : 0) + (whiteWhaleEnabled ? 1 : 0);       

        // const notLooseBeforeCurrentTurnProbability = mathjs.combinations(looseCardsBeforeCurrentTurn, 0)
        //     * mathjs.combinations(totalCards - 1 /* current card */ - looseCardsBeforeCurrentTurn, turnOrder - 1)
        //     / mathjs.combinations(totalCards - 1, turnOrder - 1);

        // const notLooseAfterCurrentTurnProbability = mathjs.combinations(looseCards, 0)
        //     * mathjs.combinations(totalCards - 1 /* current card */ - looseCards, numberOfPlayers - turnOrder)
        //     / mathjs.combinations(totalCards - 1 /* current card */, numberOfPlayers - turnOrder);

        // probabilities.push({
        //     probability: 1 - notLooseBeforeCurrentTurnProbability * notLooseAfterCurrentTurnProbability,
        //     points: trickMissPoints
        // });
    }

    return groupByPoints(probabilities);
    //return probabilities;
}

function groupByPoints(
    probabilities: ProbabilityPoints[]
): ProbabilityPoints[] {
    return Object.values(
        probabilities.reduce<Record<number, ProbabilityPoints>>(
            (acc, { points, probability }) => {
                if (!acc[points]) {
                    acc[points] = { points, probability: new Fraction(0) };
                }

                acc[points].probability = acc[points].probability.add(probability);
                return acc;
            },
            {}
        )
    );
}

