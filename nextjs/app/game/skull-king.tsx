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

        const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 2 /* other suits */ + (card.value - 1) + numberOfEscapes;

        const winCards = numberOfSuitValues * 2 /* other suits */ + (card.value - 1) /* current suit */ + numberOfEscapes;
        const looseCards = totalCards - 1 /* current card */ - winCards;

        probabilities.push(...calculate(
            (card.value === numberOfSuitValues ? suit14BonusPoints : 0),
            numberOfPlayers - 1,
            [
                { points: suit14BonusPoints, cardsCount: 2 },
            ],
            safeCardsWithoutBonus,
            looseCards,
            0 /* sameCardsCount */,
            turnOrder,
            totalCards
        ));

        // // итенация по количеству номиналов с бонусами у соперников (бонусов не более 2 других мастей)
        // for (let suit14Count = 0; suit14Count <= mathjs.min(numberOfPlayers - 1, 2); suit14Count++) {
        //     const sute14Combinations = mathjs.combinations(2, suit14Count);

        //     const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 2 /* other suits */ + (card.value - 1) + numberOfEscapes;
        //     const safeCardsWithoutBonusCombinations = mathjs.combinations(safeCardsWithoutBonus, numberOfPlayers - 1 - suit14Count);

        //     const unsafeCards = totalCards - 1 /* current card */ - safeCardsWithoutBonus - 2 /* possible suit14 bonuses */;
        //     const unsafeCardsCombinations = mathjs.combinations(unsafeCards, 0);

        //     probabilities.push({
        //         probability: new Fraction(sute14Combinations * safeCardsWithoutBonusCombinations * unsafeCardsCombinations, totalCombinations),
        //         points: (suit14Count + (card.value === numberOfSuitValues ? 1 : 0)) * suit14BonusPoints + bidMatchPoints
        //     });
        // }

        // const winCards = numberOfSuitValues * 2 /* other suits */ + (card.value - 1) /* current suit */ + numberOfEscapes;
        // const looseCards = totalCards - 1 /* current card */ - winCards;
        // const winWithAnyBonusProbability = new Fraction(mathjs.combinations(looseCards, 0) * mathjs.combinations(winCards, numberOfPlayers - 1), totalCombinations);

        // probabilities.push({
        //     probability: new Fraction(1).sub(winWithAnyBonusProbability),
        //     points: bidMissPoints
        // });
    }
    else if (card.type === "jolly-roger") {

        const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 3 /* other suits */ + (card.value - 1) + numberOfEscapes;

        const winCards = numberOfSuitValues * 3 /* other suits */ + (card.value - 1) /* current jolly-roger suit */ + numberOfEscapes;
        const looseCards = totalCards - 1 /* current card */ - winCards;

        probabilities.push(...calculate(
            (card.value === numberOfSuitValues ? jollyRogerBonusPoints : 0),
            numberOfPlayers - 1,
            [
                { points: suit14BonusPoints, cardsCount: 3 },
                // { points: 0, cardsCount: safeCardsWithoutBonus }
            ],
            safeCardsWithoutBonus,
            looseCards,
            0 /* sameCardsCount */,
            turnOrder,
            totalCards
        ));

        // // итенация по количеству номиналов с бонусами у соперников (бонусов не более 3 других мастей)
        // for (let suit14Count = 0; suit14Count <= mathjs.min(numberOfPlayers - 1, 3); suit14Count++) {
        //     const sute14Combinations = mathjs.combinations(3, suit14Count);

        //     const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 3 /* other suits */ + (card.value - 1) + numberOfEscapes;
        //     const safeCardsWithoutBonusCombinations = mathjs.combinations(safeCardsWithoutBonus, numberOfPlayers - 1 - suit14Count);

        //     const unsafeCards = totalCards - 1 /* current card */ - safeCardsWithoutBonus - 2 /* possible suit14 bonuses */;
        //     const unsafeCardsCombinations = mathjs.combinations(unsafeCards, 0);

        //     probabilities.push({
        //         probability: new Fraction(sute14Combinations * safeCardsWithoutBonusCombinations * unsafeCardsCombinations, totalCombinations),
        //         points: suit14Count * suit14BonusPoints + (card.value === numberOfSuitValues ? jollyRogerBonusPoints : 0) + bidMatchPoints
        //     });
        // }

        // const winCards = numberOfSuitValues * 3 /* other suits */ + (card.value - 1) /* current jolly-roger suit */ + numberOfEscapes;
        // const looseCards = totalCards - 1 /* current card */ - winCards;
        // const winWithAnyBonusProbability = mathjs.combinations(looseCards, 0) * mathjs.combinations(winCards, numberOfPlayers - 1) / totalCombinations;

        // probabilities.push({
        //     probability: new Fraction(1).sub(winWithAnyBonusProbability),
        //     points: bidMissPoints
        // });
    }
    else if (card.type === "escape") {

        const safeCardsWithoutBonus = 0; //numberOfEscapes - 1 /* current card */;
        const winCards = numberOfEscapes - 1 /* current card */;
        const looseCards = totalCards - 1 /* current card */ - winCards;

        probabilities.push(...calculate(
            0,
            numberOfPlayers - 1,
            [],
            safeCardsWithoutBonus,
            looseCards,
            numberOfEscapes - 1 /* current card */,
            turnOrder,
            totalCards
        ));

        // if (numberOfPlayers > numberOfEscapes || turnOrder != 1) {
        //     probabilities.push({
        //         probability: new Fraction(1),
        //         points: bidMissPoints
        //     });
        // } else {

        //     const safeCards = numberOfEscapes - 1 /* current card */;
        //     const safeCardsCombinations = mathjs.combinations(safeCards, numberOfPlayers - 1);

        //     const unsafeCards = totalCards - 1 /* current card */ - safeCards;
        //     const unsafeCardsCombinations = mathjs.combinations(unsafeCards, 0);
        //     const loseOnUnsafeCardsCombinations = mathjs.combinations(unsafeCards, numberOfPlayers - 1);

        //     const totalCombinations = mathjs.combinations(totalCards - 1, numberOfPlayers - 1);

        //     probabilities.push({
        //         probability: new Fraction(safeCardsCombinations * unsafeCardsCombinations, totalCombinations),
        //         points: bidMatchPoints
        //     });

        //     probabilities.push({
        //         probability: new Fraction(loseOnUnsafeCardsCombinations, totalCombinations),
        //         points: bidMissPoints
        //     });
        // }
    }
    else if (card.type == "kraken") {
        probabilities.push({
            probability: new Fraction(1),
            points: bidMissPoints
        });
    }
    else if (card.type === "pirate") {

        const otherPirateCards = numberOfPirates + 1 /* tigress */ - 1 /* current card */;
        const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 4 + numberOfEscapes;

        probabilities.push(...calculate(
            0,
            numberOfPlayers - 1,
            [
                { points: suit14BonusPoints, cardsCount: 3 },
                { points: jollyRogerBonusPoints, cardsCount: 1 },
                { points: mermaidBonusPoints, cardsCount: numberOfMermaids },
                //{ points: 0, cardsCount: safeCardsWithoutBonus }
            ],
            safeCardsWithoutBonus,
            1 /* skull-king */ + (krakenEnabled ? 1 : 0) + (whiteWhaleEnabled ? 1 : 0),
            otherPirateCards,
            turnOrder,
            totalCards
        ));
    }

    // else if (card.type == "pirate") {

    //     const otherPirateCards = (numberOfPirates + 1 /* tigress */) - 1/* current card */;

    //     // итерация по количеству номиналов с бонусами некозырной 14 у соперников (бонусов не более 3)
    //     for (let suit14Count = 0; suit14Count <= mathjs.min(numberOfPlayers - 1, 3); suit14Count++) {
    //         // итерация по количеству бонусов козырной 14 у соперников (не более 1, в пределах количества соперников)
    //         for (let jollyRoger14Count = 0; jollyRoger14Count <= mathjs.min(numberOfPlayers - 1 - suit14Count, 1); jollyRoger14Count++) {
    //             // итерация по количеству бонусов русалок у соперников (не более количества русалок, в пределах количества соперников)
    //             for (let mermaidCount = 0; mermaidCount <= mathjs.min(numberOfPlayers - 1 - suit14Count - jollyRoger14Count, numberOfMermaids); mermaidCount++) {
    //                 // итерация по количеству карт с пиратами или tigress у соперников
    //                 // (не более количества пиратов минус текущая карта, в пределах количества соперников)
    //                 for (let pirateCount = 0; pirateCount <= mathjs.min(numberOfPlayers - 1 - suit14Count - jollyRoger14Count - mermaidCount, otherPirateCards); pirateCount++) {

    //                     const sute14Combinations = mathjs.combinations(3, suit14Count);
    //                     const jollyRoger14Combinations = mathjs.combinations(1, jollyRoger14Count);
    //                     const mermaidCombinations = mathjs.combinations(numberOfMermaids, mermaidCount);
    //                     const pirateCombinations = mathjs.combinations(otherPirateCards, pirateCount);

    //                     const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 4
    //                         + numberOfEscapes;
    //                     const safeCardsWithoutBonusCombinations = mathjs.combinations(safeCardsWithoutBonus, numberOfPlayers - 1
    //                         - suit14Count - jollyRoger14Count - mermaidCount - pirateCount);

    //                     const unsafeCards = totalCards - 1 /* current card */ - safeCardsWithoutBonus - 3 /* possible suit14 bonuses */
    //                         - 1 /* possible jolly-roger14 bonus */ - numberOfMermaids;
    //                     const unsafeCardsCombinations = mathjs.combinations(unsafeCards, 0);

    //                     // на numberOfPlayers-1 игроков вышло pirateCount пиратов
    //                     // определяем вероятность, что карта пиратов вышла не перед текущим ходом
    //                     const notLooseBeforeCurrentTurnProbability = (turnOrder - 1 > numberOfPlayers - 1 - pirateCount)
    //                         ? new Fraction(0)
    //                         : new Fraction(mathjs.combinations(numberOfPlayers - 1 - pirateCount, turnOrder - 1),
    //                             mathjs.combinations(numberOfPlayers - 1, turnOrder - 1));

    //                     const combinations = sute14Combinations * jollyRoger14Combinations * mermaidCombinations * pirateCombinations * safeCardsWithoutBonusCombinations * unsafeCardsCombinations;
    //                     probabilities.push({
    //                         probability: notLooseBeforeCurrentTurnProbability.mul(new Fraction(combinations, totalCombinations)),
    //                         points: suit14Count * suit14BonusPoints + jollyRoger14Count * jollyRogerBonusPoints
    //                             + mermaidCount * mermaidBonusPoints + bidMatchPoints
    //                     });

    //                     probabilities.push({
    //                         probability: new Fraction(1).sub(notLooseBeforeCurrentTurnProbability).mul(combinations).div(totalCombinations),
    //                         points: bidMissPoints
    //                     });

    //                 }
    //             }
    //         }
    //     }

    //     const winCards = numberOfSuitValues * 4 /* suits */ + numberOfEscapes + numberOfMermaids + otherPirateCards;
    //     const looseCards = 1 /* skull-king */ + (krakenEnabled ? 1 : 0) + (whiteWhaleEnabled ? 1 : 0);
    //     const winWithAnyBonusProbability = mathjs.combinations(looseCards, 0) * mathjs.combinations(winCards, numberOfPlayers - 1) / totalCombinations;

    //     probabilities.push({
    //         probability: new Fraction(1).sub(winWithAnyBonusProbability),
    //         points: bidMissPoints
    //     });
    // }

    else if (card.type === "tigress") {

        const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 4 + numberOfEscapes;

        probabilities.push(...calculate(
            0,
            numberOfPlayers - 1,
            [
                { points: suit14BonusPoints, cardsCount: 3 },
                { points: jollyRogerBonusPoints, cardsCount: 1 },
                { points: mermaidBonusPoints, cardsCount: numberOfMermaids },
            ],
            safeCardsWithoutBonus,
            1 /* skull-king */ + (krakenEnabled ? 1 : 0) + (whiteWhaleEnabled ? 1 : 0),
            numberOfPirates,
            turnOrder,
            totalCards
        ));
    }

    else if (card.type === "mermaid") {

        const otherMermaidCards = numberOfMermaids - 1 /* current card */;
        const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 4 + numberOfEscapes;

        probabilities.push(...calculate(
            0,
            numberOfPlayers - 1,
            [
                { points: suit14BonusPoints, cardsCount: 3 },
                { points: jollyRogerBonusPoints, cardsCount: 1 },
                { points: skullKingBonusPoints, cardsCount: 1 },
                //{ points: 0, cardsCount: safeCardsWithoutBonus }
            ],
            safeCardsWithoutBonus,
            numberOfPirates + 1 /* tigress */ + (krakenEnabled ? 1 : 0) + (whiteWhaleEnabled ? 1 : 0),
            otherMermaidCards,
            turnOrder,
            totalCards
        ));
    }

    else if (card.type === "skull-king") {

        const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 4 + numberOfEscapes;

        probabilities.push(...calculate(
            0,
            numberOfPlayers - 1,
            [
                { points: suit14BonusPoints, cardsCount: 3 },
                { points: jollyRogerBonusPoints, cardsCount: 1 },
                { points: pirateBonusPoints, cardsCount: numberOfPirates + 1 /* tigress */ },
            ],
            safeCardsWithoutBonus,
            numberOfMermaids + (krakenEnabled ? 1 : 0) + (whiteWhaleEnabled ? 1 : 0),
            0,
            turnOrder,
            totalCards
        ));
    }

    return groupByPoints(probabilities);
    //return probabilities;
}

function calculate(
    currentCardPoints: number,
    numberOfOtherPlayers: number,
    bonusCards: { points: number; cardsCount: number }[],
    safeCardsWithoutBonus: number,
    looseCardsCount: number,
    sameCardsCount: number,
    turnOrder: number,
    totalCards: number
): ProbabilityPoints[] {

    const probabilities: ProbabilityPoints[] = [];
    const totalCombinations = mathjs.combinations(totalCards - 1 /* current card */, numberOfOtherPlayers);

    function dfs(
        index: number,
        takenPlayers: number,
        combinations: number,
        points: number,
    ) {
        if (takenPlayers > numberOfOtherPlayers) return;

        if (index === bonusCards.length) {
            // const remaining = numberOfOtherPlayers - takenPlayers;
            // if (remaining > sameCardsCount) return;

            for (let sameCardsTaken = 0; sameCardsTaken <= Math.min(sameCardsCount, numberOfOtherPlayers - takenPlayers); sameCardsTaken++) {

                // if (bonusCards.length === 0) {
                //     // Вырожденный случай для Escape
                //     // существует единственная победная комбинация, когда текущий игрок ходит первым и все остальные выбирают Escape
                //     combinations = (turnOrder === 1 && sameCardsTaken === numberOfOtherPlayers) ? 1 : 0;
                // }

                const safeCardsWithoutBonusCombinations = safeCardsWithoutBonus < numberOfOtherPlayers - takenPlayers - sameCardsTaken
                    ? 0
                    : mathjs.combinations(safeCardsWithoutBonus,
                        numberOfOtherPlayers - takenPlayers - sameCardsTaken);

                const sameCardsCombinations = mathjs.combinations(sameCardsCount, sameCardsTaken);

                // вероятность, что такая же карта не вышла ДО текущего хода
                const notLooseBeforeCurrentTurnProbability =
                    turnOrder - 1 > numberOfOtherPlayers - sameCardsTaken
                        ? new Fraction(0)
                        : new Fraction(
                            mathjs.combinations(
                                numberOfOtherPlayers - sameCardsTaken,
                                turnOrder - 1
                            ),
                            mathjs.combinations(
                                numberOfOtherPlayers,
                                turnOrder - 1
                            )
                        );


                const probability = notLooseBeforeCurrentTurnProbability.mul(
                    new Fraction(
                        combinations * safeCardsWithoutBonusCombinations * sameCardsCombinations,
                        totalCombinations
                    )
                );

                if (!probability.equals(0)) {
                    probabilities.push({
                        probability,
                        points: points + currentCardPoints
                    });
                }
                probabilities.push({
                    probability: new Fraction(1).sub(notLooseBeforeCurrentTurnProbability).mul(
                        combinations * safeCardsWithoutBonusCombinations * sameCardsCombinations
                    ).div(totalCombinations),
                    points: bidMissPoints
                });

            }

            return;
        }

        const { cardsCount, points: bonusPoints } = bonusCards[index];

        for (let take = 0; take <= Math.min(cardsCount, numberOfOtherPlayers - takenPlayers); take++) {
            dfs(
                index + 1,
                takenPlayers + take,
                combinations * mathjs.combinations(cardsCount, take),
                points + take * bonusPoints,
            );
        }
    }

    dfs(0, 0, 1, bidMatchPoints);

    // случай проигрыша из-за выхода более сильной карты
    const winWithAnyBonusProbability = (totalCards - looseCardsCount - 1 /*current card */ < numberOfOtherPlayers)
        ? 0
        : new Fraction(mathjs.combinations(looseCardsCount, 0) *
            mathjs.combinations(totalCards - looseCardsCount - 1 /*current card */, numberOfOtherPlayers),
            totalCombinations);

    probabilities.push({
        probability: new Fraction(1).sub(winWithAnyBonusProbability),
        points: bidMissPoints
    });

    return probabilities;
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

