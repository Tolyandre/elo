"use client"

import katex from "katex"
import "katex/dist/katex.min.css"

// Firefox has strict MathML validation; KaTeX's default "htmlAndMathml" output
// produces invalid <msub> markup for constructs like \underbrace{x}_{y}.
// Forcing HTML-only output avoids the issue across all browsers.
function BlockMath({ math }: { math: string }) {
    const html = katex.renderToString(math, { displayMode: true, output: "html", throwOnError: false })
    return <div dangerouslySetInnerHTML={{ __html: html }} />
}
function InlineMath({ math }: { math: string }) {
    const html = katex.renderToString(math, { displayMode: false, output: "html", throwOnError: false })
    return <span dangerouslySetInnerHTML={{ __html: html }} />
}
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { Suspense, useState } from "react"

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"
import { Card, CardContent } from "@/components/ui/card"
import { useSettings } from "@/app/settingsContext"
import { EloCalculator } from "./EloCalculator"
import { RatingGapChart } from "./RatingGapChart"
import { ConvergenceChart } from "./ConvergenceChart"
import { PageHeader } from "@/app/pageHeaderContext"

// ─── Page ────────────────────────────────────────────────────────────────────

function HelpPageContent() {
    const settings = useSettings()
    const searchParams = useSearchParams()
    const router = useRouter()
    const pathname = usePathname()

    const [openItems, setOpenItems] = useState<string[]>(() => {
        const param = searchParams.get("open")
        return param ? param.split(",") : []
    })

    function handleValueChange(values: string[]) {
        setOpenItems(values)
        const params = new URLSearchParams(searchParams.toString())
        if (values.length > 0) {
            params.set("open", values.join(","))
        } else {
            params.delete("open")
        }
        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }

    return (
        <div className="space-y-6 py-6">
            <PageHeader title="Справка" />
            <p>
                Elo-рейтинг для настольных игр
            </p>

            <Accordion type="multiple" value={openItems} onValueChange={handleValueChange} className="w-full border rounded-lg px-4">

                {/* ── Section 1: What is Elo ── */}
                <AccordionItem value="what-is-elo">
                    <AccordionTrigger className="text-base font-semibold">
                        Что такое Elo-рейтинг?
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 text-sm leading-relaxed">
                        <p>
                            Система рейтингов Elo — математический метод расчёта относительного уровня игроков
                            в соревновательных играх. Разработана венгерско-американским физиком Арпадом Ело
                            для шахмат и впоследствии адаптирована для многих других игр.
                        </p>
                        <p>
                            Ключевая идея: рейтинг отражает не абсолютный навык, а&nbsp;
                            <em>ожидаемый результат в сравнении с конкретным противником</em>.
                            После каждой партии рейтинг победителя растёт, а проигравшего — падает
                            ровно на столько, на сколько вырос у победителя.
                        </p>
                        <p>
                            Приложение отображает рейтинг как целое число, однако внутри
                            хранится точное дробное значение. Дробная часть учитывается в каждом
                            последующем расчёте, поэтому накопленные изменения корректно
                            отражаются в рейтинге со временем.
                        </p>
                    </AccordionContent>
                </AccordionItem>

                {/* ── Section 2: Formulas ── */}
                <AccordionItem value="formulas">
                    <AccordionTrigger className="text-base font-semibold">
                        Формулы расчёта
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 text-sm leading-relaxed">
                        <p>
                            Для многопользовательской партии из <InlineMath math="N" /> игроков
                            приложение использует обобщённую версию алгоритма Elo.
                        </p>

                        <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
                            1. Ожидаемый результат игрока i
                        </p>
                        <p>
                            Для каждой пары игроков вычисляется вероятность того, что игрок{" "}
                            <InlineMath math="i" /> опередит игрока <InlineMath math="j" />:
                        </p>
                        <Card className="bg-muted/50">
                            <CardContent className="py-3 overflow-x-auto">
                                <BlockMath math={String.raw`p_{ij} = \frac{1}{1 + 10^{(R_j - R_i)\,/\,D}}`} />
                            </CardContent>
                        </Card>
                        <p>
                            <InlineMath math="R_i" /> и <InlineMath math="R_j" /> — рейтинги игроков <InlineMath math="i" /> и <InlineMath math="j" /> до партии.
                        </p>
                        <p>
                            <InlineMath math="D" /> — масштабирующий параметр
                            (обычно 400): при разнице рейтингов в <InlineMath math="D" /> пунктов
                            более сильный побеждает в 91% случаев.
                        </p>
                        <p>
                            Затем вероятности суммируются по всем соперникам и нормируются
                            на количество пар <InlineMath math="\binom{N}{2} = N(N-1)/2" />:
                        </p>
                        <Card className="bg-muted/50">
                            <CardContent className="py-3 overflow-x-auto">
                                <BlockMath math={String.raw`E_i = \frac{\displaystyle\sum_{j \neq i} p_{ij} \;-\; 0{,}5}{\dfrac{N(N-1)}{2}}`} />
                            </CardContent>
                        </Card>
                        <p>Где <InlineMath math="N" /> - количество игроков, <InlineMath math="E_i" /> — ожидаемый результат игрока <InlineMath math="i" /> в диапазоне <InlineMath math="[0,\,1]" />.
                            При этом <InlineMath math="\sum_{i} E_i = 1" />.</p>
                        <p>
                            Вычитание <InlineMath math="0{,}5" /> компенсирует то, что каждый игрок
                            учитывает себя в сумме.
                        </p>

                        <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
                            2. Фактический нормализованный счёт
                        </p>
                        <p>
                            Очки в партии нормируются относительно минимального результата,
                            чтобы счёт <InlineMath math="S_i" /> лежал в диапазоне <InlineMath math="[0,\,1]" />:
                        </p>
                        <Card className="bg-muted/50">
                            <CardContent className="py-3 overflow-x-auto">
                                <BlockMath math={String.raw`S_i = \frac{(\text{score}_i - \text{score}_{\min})^W}{\displaystyle\sum_j (\text{score}_j - \text{score}_{\min})^W}`} />
                            </CardContent>
                        </Card>
                        <p>
                            Нормализация происходит пропорционально степени <InlineMath math="W" /> (WinReward) победных очков.
                            При <InlineMath math="W = 1" /> нормализация линейна (поведение как в классическом Elo).
                            При <InlineMath math="W &gt; 1" /> победители получают непропорционально бо́льшую долю рейтинга.
                        </p>
                        <p>
                            Если все игроки набрали одинаковое количество очков, каждый получает{" "}
                            <InlineMath math="S_i = 1/N" /> (ничья).
                        </p>

                        <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
                            3. Изменение рейтинга
                        </p>
                        <Card className="bg-muted/50">
                            <CardContent className="py-3 overflow-x-auto">
                                <BlockMath math={String.raw`\Delta R_i = K \cdot (S_i - E_i)`} />
                            </CardContent>
                        </Card>
                        <p>
                            <InlineMath math="K" /> — коэффициент волатильности. Чем он выше,
                            тем сильнее одна партия меняет рейтинг. Типичное значение — 32.
                        </p>
                        <p>
                            В данном приложении настроены{" "}
                            <InlineMath math={`K = ${settings.eloConstK}`} />,{" "}
                            <InlineMath math={`D = ${settings.eloConstD}`} />,{" "}
                            <InlineMath math={`W = ${settings.winReward}`} />{" "}
                            и начальный рейтинг <InlineMath math={`R_0 = ${settings.startingElo}`} />.
                        </p>
                        <p>
                            Удобно раскрыть формулу через два слагаемых в единицах рейтинга:
                        </p>
                        <Card className="bg-muted/50">
                            <CardContent className="py-3 overflow-x-auto">
                                <BlockMath math={String.raw`\Delta R_i = \underbrace{K \cdot S_i}_{\text{заработано}} - \underbrace{K \cdot E_i}_{\text{плата за участие}}`} />
                            </CardContent>
                        </Card>
                        <p>
                            <InlineMath math="K \cdot S_i" /> — заработанные очки рейтинга: сколько рейтинга игрок
                            получил бы, если бы побеждал бесплатно. Зависит только от его результата
                            в партии относительно остальных.
                        </p>
                        <p>
                            <InlineMath math="K \cdot E_i" /> — плата за участие: сколько рейтинга система
                            автоматически «списывает», исходя из ожидаемого результата.
                            Чем сильнее соперники, тем меньше плата — и тем выгоднее победа.
                        </p>
                        <p>
                            Итог: <InlineMath math="\Delta R_i > 0" /> когда игрок выступил
                            лучше ожидания, и <InlineMath math="\Delta R_i < 0" /> — хуже.
                            Сумма всех изменений по партии равна нулю: рейтинг перераспределяется
                            между участниками.
                        </p>
                    </AccordionContent>
                </AccordionItem>

                {/* ── Section 3: Arenas and leagues ── */}
                <AccordionItem value="arenas">
                    <AccordionTrigger className="text-base font-semibold">
                        Арены и лиги
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 text-sm leading-relaxed">
                        <p>
                            Рейтинг рассчитывается отдельно для <strong>глобальной арены</strong> (все игры вместе)
                            и для каждой <strong>игровой арены</strong> (отдельно для каждой игры).
                            Это позволяет видеть как общий уровень игрока, так и его мастерство в конкретной игре.
                        </p>

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
                    </AccordionContent>
                </AccordionItem>

                {/* ── Section 4: Beginner rating ── */}
                <AccordionItem value="beginner-rating">
                    <AccordionTrigger className="text-base font-semibold">
                        Рейтинг новичков на арене
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 text-sm leading-relaxed">
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
                            которая описана в предыдущем разделе. Для расчёта рейтинга используется та же формула, но
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
                    </AccordionContent>
                </AccordionItem>

                {/* ── Section 5: When to apply Elo ── */}
                <AccordionItem value="when-elo">
                    <AccordionTrigger className="text-base font-semibold">
                        Когда применяется Elo?
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 text-sm leading-relaxed">
                        <p>
                            Elo-рейтинг имеет смысл только тогда, когда игроки напрямую
                            соревнуются друг с другом и их результаты можно сравнить в рамках
                            одной партии.
                        </p>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <Card className="border-green-200 dark:border-green-800">
                                <CardContent className="pt-4 space-y-2">
                                    <p className="font-semibold text-green-700 dark:text-green-400">
                                        Подходит
                                    </p>
                                    <ul className="space-y-1 text-sm list-none">
                                        {[
                                            "Соревновательные игры от 2 и более участников",
                                            "Карточные игры: Шакал, Тысяча, Преферанс",
                                            "Настолки с личными очками: Каркассон, Агрикола",
                                            "Шахматы, шашки, го — победа кодируется как 1, поражение как 0",
                                            "Спортивные дисциплины с личным зачётом",
                                        ].map(item => (
                                            <li key={item} className="flex gap-2">
                                                <span className="text-green-600 dark:text-green-400 shrink-0">✓</span>
                                                {item}
                                            </li>
                                        ))}
                                    </ul>
                                </CardContent>
                            </Card>

                            <Card className="border-red-200 dark:border-red-800">
                                <CardContent className="pt-4 space-y-2">
                                    <p className="font-semibold text-red-700 dark:text-red-400">
                                        Не подходит
                                    </p>
                                    <ul className="space-y-1 text-sm list-none">
                                        {[
                                            "Соло-игры (нет соперников для сравнения)",
                                            "Кооперативные игры: все побеждают или проигрывают вместе",
                                            "Игры без объективного счёта: Диксит, Имаджинариум, Крокодил",
                                            "Игры с сильным элементом случайности без навыка",
                                        ].map(item => (
                                            <li key={item} className="flex gap-2">
                                                <span className="text-red-600 dark:text-red-400 shrink-0">✗</span>
                                                {item}
                                            </li>
                                        ))}
                                    </ul>
                                </CardContent>
                            </Card>
                        </div>

                        <p>
                            Главное условие: в партии должен быть <strong>личный счёт каждого игрока</strong>,
                            по которому можно определить, кто выступил лучше или хуже остальных.
                            В кооперативных играх такого разделения нет — все игроки либо побеждают,
                            либо проигрывают вместе, поэтому индивидуальный рейтинг не имеет смысла.
                        </p>

                        <p>
                            Если в игре победитель определяется не накопленными очками, а специальным
                            условием (мат в шахматах, последняя взятка, выбывание соперника), вместо
                            реального счёта используются условные баллы: <strong>победа = 1, поражение = 0</strong>,
                            ничья = 0,5. Алгоритм от этого не меняется — нормализованный счёт{" "}
                            <InlineMath math="S_i" /> по-прежнему корректно отражает итог партии.
                        </p>

                        <p>
                            В играх, где есть и личный счёт и специальные условия победы (Инновация, Карта звёзд), также
                            применяются условные баллы <strong>победа = 1, поражение = 0</strong>.
                        </p>
                    </AccordionContent>
                </AccordionItem>

                {/* ── Section 6: Interactive calculator ── */}
                <AccordionItem value="calculator">
                    <AccordionTrigger className="text-base font-semibold">
                        Пример расчёта (интерактивный)
                    </AccordionTrigger>
                    <AccordionContent>
                        <EloCalculator />
                    </AccordionContent>
                </AccordionItem>

                {/* ── Section 7: Goals and etiquette ── */}
                <AccordionItem value="etiquette">
                    <AccordionTrigger className="text-base font-semibold">
                        Цели и правила использования
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 text-sm leading-relaxed">
                        <p>
                            Главная цель приложения — <strong>добавить азарт и соревновательную составляющую</strong> в настольные игры.
                        </p>
                        <p>
                            Игроки, которым хочется просто играть, могут участвовать и игнорировать
                            своё положение в таблице. Это позволяет получать удовольствие от рейтинга тем, кому это интересно.
                        </p>

                        <Card>
                            <CardContent className="pt-4 space-y-2">
                                <p className="font-semibold">Дружелюбная атмосфера</p>
                                <p className="text-muted-foreground">
                                    Рейтинг не меняет отношения между игроками. Как победа и поражение в настольных играх
                                    не влияют на дружбу за столом, так и позиция в рейтинге — не повод для упрёков
                                    или давления. Ко всем участникам рейтинга следует относиться одинаково уважительно,
                                    независимо от их места в таблице.
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardContent className="pt-4 space-y-2">
                                <p className="font-semibold">Прозрачность: считается партия или нет</p>
                                <p className="text-muted-foreground">
                                    Перед началом партии каждый игрок должен понимать, вносится ли она в рейтинг.
                                    Если это неочевидно или за столом есть новые игроки — организаторы обязаны
                                    сообщить об этом заранее.
                                </p>
                                <p className="text-muted-foreground">
                                    Игроки могут договориться не вносить партию в рейтинг — например, если партия
                                    ознакомительная, сыграна с заменой игроков или не может быть завершена.
                                    Такое решение принимается по согласию всех участников.
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardContent className="pt-4 space-y-2">
                                <p className="font-semibold"> Рейтинг не должен быть причиной для отмены партии</p>
                                <p className="text-muted-foreground">
                                    Если кто-то из вашей компании не хочет видеть себя в рейтинге,
                                    не используйте это приложение.
                                </p>
                                <p className="text-muted-foreground">
                                    Удаление игроков, которые сыграли хотя бы одну партию, не предусмотрено, т.к. это повлияло бы на расчёт.
                                    Однако, можно изменить имя игрока на что-то нейтральное ("данные удалены"),
                                    если он не хочет, чтобы его имя было в таблице.
                                </p>
                            </CardContent>
                        </Card>
                    </AccordionContent>
                </AccordionItem>

                {/* ── Section 8: Who adds data to the rating? ── */}
                <AccordionItem value="etiquette">
                    <AccordionTrigger className="text-base font-semibold">
                        Кто вносит данные в рейтинг
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 text-sm leading-relaxed">
                        <p>
                            Результаты партий вносят <strong>администраторы</strong> — пользователи,
                            авторизовавшиеся через аккаунт Google и добавленные в список доверенных лиц.
                        </p>
                        <p>
                            Чтобы стать администратором, войдите через Google и попросите действующего
                            администратора добавить вас в список. Администраторы обязуются внимательно вносить результаты партии.
                        </p>
                        <p>
                            Администратор может добавлять партии с любыми игроками, добавлять новых игроков.
                        </p>

                    </AccordionContent>
                </AccordionItem>

                {/* ── Section 9: Tips ── */}
                <AccordionItem value="tips">
                    <AccordionTrigger className="text-base font-semibold">
                        Советы игрокам
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 text-sm leading-relaxed">
                        <p>
                            Понимание формулы помогает принимать стратегические решения — не только
                            внутри партии, но и при выборе противников.
                        </p>

                        <div className="space-y-3">
                            <Card>
                                <CardContent className="pt-4">
                                    <p className="font-semibold mb-1">
                                        1. Побеждать сильных выгоднее, чем слабых
                                    </p>
                                    <p className="text-muted-foreground">
                                        Плата <InlineMath math="K \cdot E_i" /> против сильных игроков низкая,
                                        а заработок <InlineMath math="K \cdot S_i" /> при победе над ними большой —
                                        итоговый <InlineMath math="\Delta R_i" /> максимален.
                                        Разгром слабых при высокой плате <InlineMath math="K \cdot E_i" /> приносит мало.
                                    </p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardContent className="pt-4">
                                    <p className="font-semibold mb-1">
                                        2. Не бойся играть с сильными — потери минимальны
                                    </p>
                                    <p className="text-muted-foreground">
                                        Если плата <InlineMath math="K \cdot E_i" /> мала,
                                        то потеря при проигрыше тоже мала: <InlineMath math="\Delta R_i = K \cdot S_i - K \cdot E_i" />,
                                        а <InlineMath math="K \cdot S_i \geq 0" />. Избегать таких партий невыгодно —
                                        риск невелик, а потенциал роста велик.
                                    </p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardContent className="pt-4 space-y-4">
                                    <p className="font-semibold mb-1">
                                        3. Важен отрыв по очкам, а не просто порядок мест
                                    </p>
                                    <p className="text-muted-foreground">
                                        Это справедливо если игроков больше 2. Чем больше игроков,
                                        и чем больше ваш отрыв по очкам от остальных, тем больше заработок рейтинга.
                                    </p>
                                    <p className="text-muted-foreground">
                                        Имеет значение разница в очках, а не просто порядок мест. Победа с
                                        отрывом принесёт больше рейтинга, чем победа в одно очко.
                                    </p>
                                    <p className="text-muted-foreground">
                                        Если один игрок побеждает с большим отрывом, а все остальные примерно на одном уровне очков,
                                        то он получает почти весь заработок рейтинга, а остальные — почти ничего.
                                        Если несколько игроков победили с большим отрывом от одного проигравшего, то они получат немного рейтинга.
                                    </p>

                                    <p className="text-muted-foreground">
                                        Разрешение ничейной ситуции (tie break) не влияет на формулу,
                                        так как она учитывает только очки игроков, а не их порядок. Если игроки набрали одинаковое количество очков,
                                        они получат одинаковый заработок рейтинга, независимо от порядка мест.
                                    </p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardContent className="pt-4">
                                    <p className="font-semibold mb-1">
                                        4. Стабильность важнее редких всплесков
                                    </p>
                                    <p className="text-muted-foreground">
                                        Рейтинг растёт при стабильном превышении фактического
                                        результата над ожидаемым. Начисление рейтинга за одну партию ограничено коэффициентом <InlineMath math="K" />,
                                        поэтому несколько побед лучше, чем одна громкая.
                                    </p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardContent className="pt-4">
                                    <p className="font-semibold mb-1">
                                        5. Больше партий — точнее рейтинг
                                    </p>
                                    <p className="text-muted-foreground">
                                        Игроки начинают с {settings.startingElo} рейтинга.
                                        Чем больше сыграно игр, тем точнее рейтинг отражает уровень игрока.
                                        Игроки, которые сыграли достаточно партий, попадают в ранжированный список.
                                    </p>
                                </CardContent>
                            </Card>
                        </div>
                    </AccordionContent>
                </AccordionItem>

            </Accordion>
        </div>
    )
}

export default function HelpPage() {
    return (
        <Suspense>
            <HelpPageContent />
        </Suspense>
    )
}
