"use client"

import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/app/pageHeaderContext"
import { useSettings } from "@/app/settingsContext"
import { BlockMath, InlineMath } from "../math"
import { AnchorHeading } from "../anchor-heading"
import { RatingGapChart } from "./RatingGapChart"
import { ConvergenceChart } from "./ConvergenceChart"

export default function HelpArenasPage() {
    const settings = useSettings();
    return (
        <>
            <PageHeader title="Арены и лиги" />
            <p className="text-sm leading-relaxed">
                Рейтинг ведётся не одной таблицей, а несколькими аренами, а арены делятся
                на лиги — чтобы и новички, и опытные игроки играли в осмысленной для себя
                части таблицы.
            </p>

            {/* ── Арены ── */}
            <section className="space-y-4 text-sm leading-relaxed">
                <AnchorHeading id="arenas">Арены: глобальная и игровые</AnchorHeading>
                <p>
                    Рейтинг рассчитывается отдельно для <strong>глобальной арены</strong> (все игры вместе)
                    и для каждой <strong>игровой арены</strong> (отдельно для каждой игры).
                    Это позволяет видеть как общий уровень игрока, так и его мастерство в конкретной игре.
                </p>
                <p>
                    Партия попадает на арену той игры, в которую играли, и одновременно влияет
                    на глобальный рейтинг. Турниры создают собственную арену — об этом
                    рассказано в <strong className="font-semibold">статье про турниры</strong>.
                </p>
            </section>

            {/* ── Лиги ── */}
            <section className="space-y-4 text-sm leading-relaxed">
                <AnchorHeading id="leagues">Лиги и переходы между ними</AnchorHeading>
                <p>Арена состоит из лиг, чтобы разделить игроков, сыгравших много партий и только начинающих, т.к.
                    начальный рейтинг не точен.
                </p>

                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
                    Структура лиг
                </p>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2 pr-4">Лига</th>
                                <th className="text-left py-2 pr-4">Смысл</th>
                                <th className="text-left py-2">Условие перехода</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            <tr>
                                <td className="py-2 pr-4 font-medium">Лига Новичков</td>
                                <td className="py-2 pr-4 text-muted-foreground">Рейтинг новичков занижен, и растёт пока не сравняется с их настоящим эло.
                                    Увеличение рейтинга с каждой партией мотивирует играть на рейтинг. Начальное действительное значение эло часто падает, что демотивирует новичков.
                                </td>
                                <td className="py-2">
                                    Переход в Лигу Любителей, когда |эло − рейтинг| ≤ {settings.newbieLeagueGoalGap}
                                </td>
                            </tr>
                            <tr>
                                <td className="py-2 pr-4 font-medium">Лига Любителей</td>
                                <td className="py-2 pr-4 text-muted-foreground">Сюда попадают игроки, рейтинг которых сравнялся с настоящим значением эло.
                                    Лига Любителей также нужна, чтобы игроки, достигшие выского эло и прекратившие играть, позволили занимать лидерство активным игрокам.
                                </td>
                                <td className="py-2">
                                    Переход в Высшую лигу при ≥ {settings.eliteMatches6m} партий за полгода
                                    и ≥ {settings.eliteMatches2m} за 2 месяца
                                </td>
                            </tr>
                            <tr>
                                <td className="py-2 pr-4 font-medium">Высшая лига</td>
                                <td className="py-2 pr-4 text-muted-foreground">Игроки, которые активно играют. Их рейтинг отражает реальное эло.</td>
                                <td className="py-2">
                                    Возврат в Лигу Любителей, если активность падает ниже порогов
                                    ({settings.eliteMatches6m} за полгода или {settings.eliteMatches2m} за 2 мес.)
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <p>
                    Новый игрок попадает в Лигу Новичков, если стартовый разрыв |эло − рейтинг| больше{" "}
                    {settings.newbieLeagueGoalGap} (стартовый рейтинг на глобальной арене — {settings.startingRatingGlobalArena},
                    на игровой — {settings.startingRatingGameArena}). Принадлежность к Высшей лиге
                    проверяется при каждой партии по скользящим счётчикам активности.
                </p>
                <p>
                    На <strong>игровой арене</strong> есть только Лига Новичков и Лига Любителей — Высшая лига
                    отсутствует.
                </p>
            </section>

            {/* ── Рейтинг новичков ── */}
            <section className="space-y-4 text-sm leading-relaxed">
                <AnchorHeading id="beginner-rating">Рейтинг новичков на арене</AnchorHeading>
                <p>
                    У каждого игрока хранятся два значения: скрытое <strong>эло</strong> (начинается с <strong>{settings.startingElo}</strong>) и
                    видимый <strong>рейтинг</strong> (начинается с <strong>{settings.startingRatingGlobalArena}</strong> на глобальной арене,
                    <strong> {settings.startingRatingGameArena}</strong> на игровой). Эло используется при расчёте ожидаемого
                    результата игрока, а также влияет на расчёт соперникам.
                    Видимый рейтинг отображается в приложении, постепенно сходясь с эло.
                </p>
                <p>
                    Это сделано, чтобы новички не разочаровывались регулярным падением рейтинга в начале, если их уровень ниже стартового эло.
                    Видимый рейтинг отражает реальный уровень только после нескольких игр.
                    Регулярный рост на старте мотивирует новичков играть больше партий. При этом
                    начисление рейтинга постепенно становится справедливым с каждой партией.
                </p>

                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
                    Формула рейтинга новичков
                </p>
                <p>
                    Для рейтинга новичков считается и рейтинг и эло. Эло считается по обычной формуле,
                    которая описана в <strong className="font-semibold">статье про рейтинг Эло</strong>. Для расчёта рейтинга используется та же формула, но
                    берётся рейтинг игрока (вместо эло) и значения эло соперников. Чтобы рейтинг быстрее стремился
                    к эло, к компоненте earned добавляется множитель, который зависит от разрыва между рейтингом и эло.
                </p>
                <p>Для эло:</p>
                <Card className="bg-muted/50">
                    <CardContent className="py-3 overflow-x-auto space-y-2">
                        <p>
                            <InlineMath math="E_i" /> — ожидаемый нормированный результат игрока <InlineMath math="i" />
                        </p><p>
                            <InlineMath math={`elo\\_staked = -K \\cdot E_i`} /> - плата за участие
                        </p><p>
                            <InlineMath math="S_i" /> — нормированные победные очки
                        </p><p>
                            <InlineMath math={`elo\\_earned = K \\cdot S_i`} /> - заработано
                        </p>
                    </CardContent>
                </Card>
                <p>
                    Для рейтинга:
                </p>
                <Card className="bg-muted/50">
                    <CardContent className="py-3 overflow-x-auto space-y-2">
                        <p>
                            <InlineMath math="E_i^\text{r}" /> — ожидаемый нормированный результат игрока <InlineMath math="i" /> при расчёте через рейтинг вместо эло
                        </p>
                        <p>
                            <InlineMath math="gap = |рейтинг - эло|" /> - разрыв между рейтингом и эло
                        </p>
                        <p className="text-xs font-medium">Когда эло &gt; рейтинг (рейтинг догоняет эло):</p>
                        <BlockMath math={String.raw`t = 1 - e^{-\text{gap}/\tau}, \quad \tau = ${settings.newbieLeagueEarnedTau}`} />
                        <BlockMath math={String.raw`\text{rating\_earned}_{\min} = ${settings.newbieLeagueEarnedMin} \cdot t, \quad \text{rating\_earned}_{\max} = K + (${settings.newbieLeagueEarnedMax} - K) \cdot t`} />
                        <BlockMath math={String.raw`\text{rating\_earned} = \text{rating\_earned}_{\min} + S_i \cdot (\text{rating\_earned}_{\max} - \text{rating\_earned}_{\min})`} />
                        <BlockMath math={String.raw`\text{rating\_staked} = -K \cdot E_i^\text{r} \quad \text{(без усиления)}`} />

                        <p className="text-xs font-medium mt-2">Когда рейтинг &gt; эло (рейтинг превысил эло):</p>
                        <BlockMath math={String.raw`t = 1 - e^{-\text{gap}/\tau}, \quad `} />
                        <BlockMath math={String.raw`\text{rating\_staked} = -\bigl(K + (${settings.newbieLeagueEarnedMax} - K)\cdot t\bigr) \cdot E_i^\text{r} \quad `} />
                        <BlockMath math={String.raw`\text{rating\_earned} = K \cdot S_i \quad \text{(без усиления)}`} />
                    </CardContent>
                </Card>
                <p>
                    При gap = 0 оба случая совпадают со стандартным Эло.
                    Пока рейтинг значительно меньше эло: <InlineMath math={"E_i^\\text{r} \\approx 0"} /> → staked ≈ 0
                    , поэтому <InlineMath math={`\\text{rating\\_earned}_{\\min} = ${settings.newbieLeagueEarnedMin}t`} /> гарантирует
                     положительный итог при поражении.
                </p>

                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
                    График 1: зависимость staked/earned от видимого рейтинга
                </p>
                <p className="text-muted-foreground">
                    Левее эло: rating_earned (зелёная) усилена. Правее эло: rating_staked (оранжевая) усилена.
                    Пунктир — elo-трек, сплошная — rating-трек.
                </p>
                <RatingGapChart />

                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
                    График 2: сходимость рейтинга
                </p>
                <p className="text-muted-foreground">
                    Симуляция нескольких игроков со случайными исходами партий. Пунктир — скрытое эло,
                    сплошная линия — видимый рейтинг. Задайте вероятность победы каждого игрока.
                </p>
                <ConvergenceChart />

                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
                    Примерное число побед для выхода из Лиги Новичков
                </p>
                <p>
                    Условие перехода в Лигу Любителей: <InlineMath math={`\\text{эло} - \\text{рейтинг} \\le ${settings.newbieLeagueGoalGap}`} /> (без модуля — рейтинг догнал эло).
                    Изменение рейтинга за одну победу с текущим разрывом <InlineMath math="g" /> (gap):
                </p>
                <Card className="bg-muted/50">
                    <CardContent className="py-3 overflow-x-auto space-y-1">
                        <BlockMath math={String.raw`\Delta_\text{win}(g) = \text{rating\_earned}_{\max}(g) - K \cdot E(g)`} />
                        <BlockMath math={String.raw`E(g) = \frac{1}{1 + 10^{g/D}}, \quad D = ${settings.eloConstD}`} />
                    </CardContent>
                </Card>
                <p>
                    Здесь <InlineMath math="E(g)" /> — ожидаемый результат игрока с рейтингом <InlineMath math="\text{эло} - g" /> против соперника с рейтингом <InlineMath math="\text{эло}" />.
                    Тогда число побед — интеграл:
                </p>
                <Card className="bg-muted/50">
                    <CardContent className="py-3 overflow-x-auto space-y-1">
                        <BlockMath math={String.raw`n_{\min} \approx \int_{\Delta}^{\text{gap}} \frac{dg}{\Delta_\text{win}(g)}`} />
                        <BlockMath math={String.raw`n_{\max} \approx \int_{\Delta}^{\text{gap}} \frac{dg}{\Delta_\text{win}(g) - K/2}, \quad \Delta = ${settings.newbieLeagueGoalGap}`} />
                    </CardContent>
                </Card>
                <p>
                    <InlineMath math="n_{\min}" /> — нижняя граница (эло фиксировано).{" "}
                    <InlineMath math="n_{\max}" /> — верхняя граница: вычитается прирост эло за победу ≈ <InlineMath math="K/2" /> (расчёт исходя из двух игроков, соперник равен по силе).
                    Отображается рядом с именем игрока в Лиге Новичков в формате <em>~ <InlineMath math="n_{\min}" /> –<InlineMath math="n_{\max}" /> побед</em>.
                </p>
            </section>
        </>
    );
}
