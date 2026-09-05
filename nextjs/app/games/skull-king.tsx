import * as mathjs from "mathjs";
import { Fraction } from "mathjs";

export const suitValues = ["jolly-roger", "chest", "parrot", "map"] as const;
export type Suit = (typeof suitValues)[number];

export const specialValues = ["skull-king", "pirate", "tigress", "mermaid", "escape", "loot", "kraken", "white-whale"] as const;
export type Special = (typeof specialValues)[number];

export type Card = { type: Suit; value: number; } | { type: Special; };
export type ProbabilityPoints = { probability: Fraction, points: number };

function isSuitCard(card: Card | null): card is { type: Suit; value: number; } {
    return (
        card !== null &&
        "value" in card
    );
}

// правила получения взяток:
// первый игрок задаёт масть. Если первый игрок сыграл белый флаг или "деньги", то масть задаёт следующий игрок (и так по цепочке)
// если первый игрок сыграл специальную карту (помимо флага или "Денег"), то масть не задана (игроки разыгрывают любые карты)
// игроки обязаны играть в масть, если она задана, или разыгрывать специальные карты
// если специальных карт не разыграно, взятку берёт старшая карта заданной масти
// черный флаг (jolly-roger) является козырной мастью, бьёт другие масти
// русалка бьёт масти и Scull King
// пират бьёт масти и русалок
// Skull King бьёт масти и пиратов
// если русалка, пират и Skull King разыграны в одной взятке, то взятку берёт русалка
// если разыграно несколько одинаковых карт (например, несколько пиратов), то взятку берёт первая разыгранная карта
// если разыгран Кракен, то взятку не получает никто
// если разыгран Кит, то специальные карты не действуют (пираты не бьют масти, Skull King не бьёт пиратов и т.д.),
//   а взятку берёт карта с максимальным числовым значением среди карт масти (любой масти), козырная масть не имеет преимущества.
//   если несколько карт одного номинала разных мастей — берёт первая по порядку хода.
//   если в розыгрыше нет карт масти (только специальные) — никто не берёт взятку.
//   тигрица, сыгранная как пират, теряет силу пирата (Кит отменяет); тигрица как белый флаг — остаётся «без взятки».
//   если ТЫ сыграл Кита — ты никогда не берёшь взятку (у тебя нет карты масти).
// если Кракен и Кит разыграны в одной взятке, то второй отменяет первого (по порядку хода).
//   например, если один игрок разыграл Кракена, а следующий — Кита, то особенность Кракена не учитывается, а работает только Кит.
// белый флаг или деньги не берут взятку (но если все игроки разыграли белый флаг или деньги, то взятку берёт первый)
// специальная карта Tigress может быть сыграна как пират или как белый флаг по желанию игрока. Если сыграна как белый флаг, она не скорится в бонусы, если взятка взята Skull King-ом.
// карта "Деньги" (loot) — 1 карта в колоде, опциональная (включается переключателем).
//   работает как Белый флаг: не берёт взятку, если хоть кто-то сыграл что-то сильнее.
//   если все сыграли Белый флаг или Деньги — берёт первый игрок.
//   заключает контракт между разыгравшим Деньги и взявшим взятку: если в конце раунда оба выполнили план → +20 каждому.
//   если взявший Деньги сам берёт взятку (edge case, все сыграли escape-подобные) — контракта нет.
//   в этом калькуляторе: предполагается, что соперник всегда выполняет свою часть контракта.
//
// начисления очков:
// если игрок взял ровно столько взяток, сколько заявлял, он получает 20 очков за каждый заявленный бид. Если игрок не взял заявленное количество взяток, он теряет 10 очков за каждую единица разности между фактом и планом.
// если игрок заявил 0 взяток и ни взял ни одной, он получает 10 * количество карт на руке в начале раунда
// если игрок заявил 0 взяток, но взял хотя бы одну, он теряет 10 * количество карт на руке в начале раунда за каждую взятку, которую он взял
// если игрок заявил и выполнил заявку, он получает бонусы за определённые карты в взятках (смотри скоринг ниже в переменных)

// в первом раунде игроки получают 1 карту, во втором - 2, и так далее.
// в этом калькуляторе рассматривается только первый раунд

const numberOfPirates = 5; // количество пиратов в колоде
const numberOfMermaids = 2; // количество русалок в колоде
const numberOfEscapes = 5; // количество белых флагов в колоде
const numberOfMoneys = 1; // количество карт Деньги в колоде
const numberOfSuitValues = 14; // количество значений в каждой масти

const bidMatchPoints = 20;
const bidMissPoints = -10;
const zeroBidPoints = 10;
const contractBonusPoints = 20; // бонус контракта карты Деньги

const suit14BonusPoints = 10; // бонусные очки за 14-ку в не-козырной масти
const jollyRogerBonusPoints = 20; // бонусные очки за 14-кой козырной масти
const mermaidBonusPoints = 20; // бонусные очки за русалку, если взятка взята пиратом (включая Tigress)
const pirateBonusPoints = 30; // бонусные очки за пирата, если взятка взята Skull King-ом
const skullKingBonusPoints = 40; // бонусные очки за короля черепов, если взятка взята русалкой
export function calculateProbabilities1(numberOfPlayers: number, turnOrder: number, card: Card,
    krakenEnabled: boolean, whiteWhaleEnabled: boolean, lootEnabled: boolean = false): ProbabilityPoints[] {

    const probabilities: ProbabilityPoints[] = [];

    const totalCards = numberOfSuitValues * 4 + 1 /* tigress */ + numberOfPirates + numberOfMermaids + numberOfEscapes
        + (lootEnabled ? numberOfMoneys : 0)
        + 1 /* skull-king */ + (krakenEnabled ? 1 : 0) + (whiteWhaleEnabled ? 1 : 0);

    // escape-подобные карты: белый флаг + деньги (если в колоде)
    const escapelikeCount = numberOfEscapes + (lootEnabled ? numberOfMoneys : 0);

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
            currentSuitSafeCards: card.value - 1,
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
            currentSuitSafeCards: 0,
            turnOrder,
            totalCards
        }));
    }
    else if (card.type === "escape") {

        probabilities.push(...calculate({
            currentCardPoints: 0,
            numberOfOtherPlayers: numberOfPlayers - 1,
            bonusCards: [],
            safeCardsWithoutBonus: 0,
            looseCardsCount: totalCards - escapelikeCount,
            sameCardsCount: escapelikeCount - 1 /* current card */,
            isSuitAndNotTrump: false,
            currentSuitSafeCards: 0,
            turnOrder,
            totalCards
        }));
    }
    else if (card.type === "loot") {
        // Деньги работают как Белый флаг для целей взятки.
        // sameCardsCount включает все escape-подобные карты (белые флаги + другие деньги).
        // Контракт-бонус учитывается только в calculateProbabilities0.
        probabilities.push(...calculate({
            currentCardPoints: 0,
            numberOfOtherPlayers: numberOfPlayers - 1,
            bonusCards: [],
            safeCardsWithoutBonus: 0,
            looseCardsCount: totalCards - escapelikeCount,
            sameCardsCount: escapelikeCount - 1 /* current card */,
            isSuitAndNotTrump: false,
            currentSuitSafeCards: 0,
            turnOrder,
            totalCards
        }));
    }
    else if (card.type == "kraken") {
        // Кракен лишает взятку победителя — никто не берёт взятку.
        // При заявке 1 всегда проигрыш.
        probabilities.push({
            probability: new Fraction(1),
            points: bidMissPoints
        });
    }
    else if (card.type === "white-whale") {
        // Кит — специальная карта без масти и числового значения.
        // Кит активирует правило «взятку берёт старшая карта масти».
        // Игрок, сыгравший Кита, никогда не берёт взятку (у него нет карты масти).
        // При заявке 1 всегда проигрыш (аналогично Кракену).
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
            currentSuitSafeCards: 0,
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
            currentSuitSafeCards: 0,
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
            currentSuitSafeCards: 0,
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
            currentSuitSafeCards: 0,
            turnOrder,
            totalCards
        }));
    }

    return groupByPoints(probabilities);
}

/**
 * Вычисляет вероятности и очки при заявке 0 для первого раунда (1 карта на руке).
 *
 * Трансформация из заявки 1:
 *   - bid=1 выигрыш (очки > -10) → bid=0 проигрыш: -10 очков
 *   - bid=1 проигрыш (очки = -10) → bid=0 выигрыш: +10 очков
 *
 * Особый случай — карта Деньги (loot):
 *   Если заявка 0 выполнена (взятку берёт соперник), применяется контракт-бонус +20,
 *   при допущении, что соперник всегда выполняет свою часть контракта. Итого: +30 очков.
 */
export function calculateProbabilities0(numberOfPlayers: number, turnOrder: number, card: Card,
    krakenEnabled: boolean, whiteWhaleEnabled: boolean, lootEnabled: boolean = false): ProbabilityPoints[] {

    const bid1 = calculateProbabilities1(numberOfPlayers, turnOrder, card, krakenEnabled, whiteWhaleEnabled, lootEnabled);
    const successBonus = card.type === "loot" ? contractBonusPoints : 0;

    return groupByPoints(bid1.map(({ probability, points }) => ({
        probability,
        points: points === bidMissPoints
            ? zeroBidPoints + successBonus   // не взял взятку → заявка 0 выполнена
            : -zeroBidPoints,                 // взял взятку → заявка 0 провалена
    })));
}

function calculate(opts: {
    currentCardPoints: number;
    numberOfOtherPlayers: number;
    bonusCards: { points: number; cardsCount: number }[];
    safeCardsWithoutBonus: number;
    looseCardsCount: number;
    sameCardsCount: number;
    isSuitAndNotTrump: boolean;
    /** Число карт текущей (не козырной) масти среди safe-карт = card.value - 1. Используется только при isSuitAndNotTrump=true. */
    currentSuitSafeCards: number;
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
        currentSuitSafeCards,
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

                const safeCardsWithouBonusTaken = numberOfOtherPlayers - takenPlayers - sameCardsTaken;
                const safeCardsWithoutBonusCombinations = safeCardsWithoutBonus < safeCardsWithouBonusTaken
                    ? 0
                    : mathjs.combinations(safeCardsWithoutBonus, safeCardsWithouBonusTaken);

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

                // если карта с мастью и некозырная, побеждаем только если первый игрок сыграл эту масть (или первый после белых флагов)
                if (isSuitAndNotTrump) {

                    // не учтено две бонусные карты в выборке (14 в двух других мастях)
                    const currentCardSetsSuteProbability = turnOrder - 1 > numberOfEscapes
                        ? new Fraction(0)
                        : new Fraction(
                            mathjs.combinations(numberOfEscapes, turnOrder - 1),
                            mathjs.combinations(safeCardsWithoutBonus, turnOrder - 1));

                    notLooseBeforeCurrentTurnProbability = notLooseBeforeCurrentTurnProbability.mul(
                        orProbability(
                            currentCardSetsSuteProbability,
                            // вероятность, что хоть один из предыдущих игроков сыграл карту нашей масти
                            // (только карты с номиналом ниже текущего попадают в safe-зону и задают масть)
                            safeCardsWithoutBonus === 0
                                ? new Fraction(0)
                                : new Fraction(currentSuitSafeCards, safeCardsWithoutBonus)
                        )
                    );
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

function orProbability(a: Fraction, b: Fraction) {
    return new Fraction(1).sub(
        (new Fraction(1).sub(a))
            .mul(new Fraction(1).sub(b))
    );
}
