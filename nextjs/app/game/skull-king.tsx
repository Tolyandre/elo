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

    if (isSuitCard(card) && card.type !== "jolly-roger") {

        const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 2 /* other suits */ + (card.value - 1) + numberOfEscapes;

        const winCards = numberOfSuitValues * 2 /* other suits */ + (card.value - 1) /* current suit */ + numberOfEscapes;
        const looseCards = totalCards - 1 /* current card */ - winCards;

        probabilities.push(...calculate({
            currentCardPoints: (card.value === numberOfSuitValues ? suit14BonusPoints : 0),
            numberOfOtherPlayers: numberOfPlayers - 1,
            bonusCards: [
                { points: suit14BonusPoints, cardsCount: 2 },
            ],
            safeCardsWithoutBonus,
            looseCardsCount: looseCards,
            sameCardsCount: 0,
            isSuitAndNotTrump: true,
            turnOrder,
            totalCards
        }));
    }
    else if (card.type === "jolly-roger") {

        const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 3 /* other suits */ + (card.value - 1) + numberOfEscapes;

        const winCards = numberOfSuitValues * 3 /* other suits */ + (card.value - 1) /* current jolly-roger suit */ + numberOfEscapes;
        const looseCards = totalCards - 1 /* current card */ - winCards;

        probabilities.push(...calculate({
            currentCardPoints: (card.value === numberOfSuitValues ? jollyRogerBonusPoints : 0),
            numberOfOtherPlayers: numberOfPlayers - 1,
            bonusCards: [
                { points: suit14BonusPoints, cardsCount: 3 },
            ],
            safeCardsWithoutBonus,
            looseCardsCount: looseCards,
            sameCardsCount: 0,
            isSuitAndNotTrump: false,
            turnOrder,
            totalCards
        }));
    }
    else if (card.type === "escape") {

        const safeCardsWithoutBonus = 0;
        const winCards = numberOfEscapes - 1 /* current card */;
        const looseCards = totalCards - 1 /* current card */ - winCards;

        probabilities.push(...calculate({
            currentCardPoints: 0,
            numberOfOtherPlayers: numberOfPlayers - 1,
            bonusCards: [],
            safeCardsWithoutBonus,
            looseCardsCount: looseCards,
            sameCardsCount: numberOfEscapes - 1 /* current card */,
            isSuitAndNotTrump: false,
            turnOrder,
            totalCards
        }));
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

        probabilities.push(...calculate({
            currentCardPoints: 0,
            numberOfOtherPlayers: numberOfPlayers - 1,
            bonusCards: [
                { points: suit14BonusPoints, cardsCount: 3 },
                { points: jollyRogerBonusPoints, cardsCount: 1 },
                { points: mermaidBonusPoints, cardsCount: numberOfMermaids },
            ],
            safeCardsWithoutBonus,
            looseCardsCount: 1 /* skull-king */ + (krakenEnabled ? 1 : 0) + (whiteWhaleEnabled ? 1 : 0),
            sameCardsCount: otherPirateCards,
            isSuitAndNotTrump: false,
            turnOrder,
            totalCards
        }));
    }

    else if (card.type === "tigress") {

        const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 4 + numberOfEscapes;

        probabilities.push(...calculate({
            currentCardPoints: 0,
            numberOfOtherPlayers: numberOfPlayers - 1,
            bonusCards: [
                { points: suit14BonusPoints, cardsCount: 3 },
                { points: jollyRogerBonusPoints, cardsCount: 1 },
                { points: mermaidBonusPoints, cardsCount: numberOfMermaids },
            ],
            safeCardsWithoutBonus,
            looseCardsCount: 1 /* skull-king */ + (krakenEnabled ? 1 : 0) + (whiteWhaleEnabled ? 1 : 0),
            sameCardsCount: numberOfPirates,
            isSuitAndNotTrump: false,
            turnOrder,
            totalCards
        }));
    }

    else if (card.type === "mermaid") {

        const otherMermaidCards = numberOfMermaids - 1 /* current card */;
        const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 4 + numberOfEscapes;

        probabilities.push(...calculate({
            currentCardPoints: 0,
            numberOfOtherPlayers: numberOfPlayers - 1,
            bonusCards: [
                { points: suit14BonusPoints, cardsCount: 3 },
                { points: jollyRogerBonusPoints, cardsCount: 1 },
                { points: skullKingBonusPoints, cardsCount: 1 },
            ],
            safeCardsWithoutBonus,
            looseCardsCount: numberOfPirates + 1 /* tigress */ + (krakenEnabled ? 1 : 0) + (whiteWhaleEnabled ? 1 : 0),
            sameCardsCount: otherMermaidCards,
            isSuitAndNotTrump: false,
            turnOrder,
            totalCards
        }));
    }

    else if (card.type === "skull-king") {

        const safeCardsWithoutBonus = (numberOfSuitValues - 1) * 4 + numberOfEscapes;

        probabilities.push(...calculate({
            currentCardPoints: 0,
            numberOfOtherPlayers: numberOfPlayers - 1,
            bonusCards: [
                { points: suit14BonusPoints, cardsCount: 3 },
                { points: jollyRogerBonusPoints, cardsCount: 1 },
                { points: pirateBonusPoints, cardsCount: numberOfPirates + 1 /* tigress */ },
            ],
            safeCardsWithoutBonus,
            looseCardsCount: numberOfMermaids + (krakenEnabled ? 1 : 0) + (whiteWhaleEnabled ? 1 : 0),
            sameCardsCount: 0,
            isSuitAndNotTrump: false,
            turnOrder,
            totalCards
        }));
    }

    return groupByPoints(probabilities);
}
function calculate(opts: {
    currentCardPoints: number;
    numberOfOtherPlayers: number;
    bonusCards: { points: number; cardsCount: number }[];
    safeCardsWithoutBonus: number;
    looseCardsCount: number;
    sameCardsCount: number;
    isSuitAndNotTrump: boolean;
    turnOrder: number;
    totalCards: number;
}): ProbabilityPoints[] {

    const {
        currentCardPoints,
        numberOfOtherPlayers,
        bonusCards,
        safeCardsWithoutBonus,
        looseCardsCount,
        sameCardsCount,
        isSuitAndNotTrump,
        turnOrder,
        totalCards
    } = opts;

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

            for (let sameCardsTaken = 0; sameCardsTaken <= Math.min(sameCardsCount, numberOfOtherPlayers - takenPlayers); sameCardsTaken++) {
                const safeCardsWithoutBonusCombinations = safeCardsWithoutBonus < numberOfOtherPlayers - takenPlayers - sameCardsTaken
                    ? 0
                    : mathjs.combinations(safeCardsWithoutBonus,
                        numberOfOtherPlayers - takenPlayers - sameCardsTaken);

                const sameCardsCombinations = mathjs.combinations(sameCardsCount, sameCardsTaken);

                // вероятность, что такая же карта не вышла ДО текущего хода
                let notLooseBeforeCurrentTurnProbability =
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

                // если карта с мастью и некозырная, побеждаем только если первый игрок сыграл эту масть
                if (isSuitAndNotTrump) {
                    notLooseBeforeCurrentTurnProbability = notLooseBeforeCurrentTurnProbability.mul(
                        turnOrder == 1
                            ? new Fraction(1)
                            : new Fraction(numberOfSuitValues - 1 /*current card*/, safeCardsWithoutBonus));
                }

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

