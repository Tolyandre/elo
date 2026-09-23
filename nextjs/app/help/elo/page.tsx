"use client"

import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/app/pageHeaderContext"
import { useSettings } from "@/app/settingsContext"
import { BlockMath, InlineMath } from "../math"
import { AnchorHeading } from "../anchor-heading"
import { EloCalculator } from "./EloCalculator"

export default function HelpEloPage() {
    const settings = useSettings();
    return (
        <>
            <PageHeader title="Рейтинг Эло" />
            <p className="text-sm leading-relaxed">
                Рейтинг Эло — ядро приложения: он превращает результаты партий в число,
                которое отражает силу каждого игрока. В этой статье — что рейтинг означает,
                по каким формулам он считается и каким играм подходит.
            </p>

            {/* ── Что такое Elo ── */}
            <section className="space-y-4 text-sm leading-relaxed">
                <AnchorHeading id="what-is-elo">Что такое рейтинг Эло?</AnchorHeading>
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
                <p>
                    Все игроки начинают с одного значения ({settings.startingElo}), и чем больше партий
                    сыграно, тем точнее рейтинг отражает реальный уровень: каждый результат уточняет
                    оценку. Поэтому стабильная игра важнее одной громкой победы.
                </p>
            </section>

            {/* ── Формулы расчёта ── */}
            <section className="space-y-4 text-sm leading-relaxed">
                <AnchorHeading id="formulas">Формулы расчёта</AnchorHeading>
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
            </section>

            {/* ── Интерактивный пример ── */}
            <section className="space-y-4 text-sm leading-relaxed">
                <AnchorHeading id="calculator">Пример расчёта (интерактивный)</AnchorHeading>
                <p>
                    Задайте коэффициенты и результаты партии — начисления пересчитаются на лету.
                    Значения по умолчанию берутся из настроек приложения.
                </p>
                <EloCalculator />
            </section>

            {/* ── Когда применяется ── */}
            <section className="space-y-4 text-sm leading-relaxed">
                <AnchorHeading id="when-elo">Когда применяется рейтинг?</AnchorHeading>
                <p>
                    Рейтинг Эло имеет смысл только тогда, когда игроки напрямую
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
            </section>

            {/* ── Практические следствия ── */}
            <section className="space-y-4 text-sm leading-relaxed">
                <AnchorHeading id="practice">Практические следствия формулы</AnchorHeading>
                <p>
                    Понимание формулы помогает принимать решения — не только внутри партии,
                    но и при выборе соперников.
                </p>
                <div className="space-y-3">
                    <Card>
                        <CardContent className="pt-4">
                            <p className="font-semibold mb-1">Побеждать сильных выгоднее, чем слабых</p>
                            <p className="text-muted-foreground">
                                Плата <InlineMath math="K \cdot E_i" /> против сильных игроков низкая,
                                а заработок <InlineMath math="K \cdot S_i" /> при победе над ними большой —
                                итоговое <InlineMath math="\Delta R_i" /> максимально.
                                Разгром слабых при высокой плате приносит мало.
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-4">
                            <p className="font-semibold mb-1">Не бойся играть с сильными — потери минимальны</p>
                            <p className="text-muted-foreground">
                                Если плата <InlineMath math="K \cdot E_i" /> мала, то и потеря при проигрыше
                                мала: <InlineMath math="\Delta R_i = K \cdot S_i - K \cdot E_i" />, а{" "}
                                <InlineMath math="K \cdot S_i \geq 0" />. Избегать таких партий невыгодно —
                                риск невелик, а потенциал роста велик.
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-4 space-y-2">
                            <p className="font-semibold mb-1">Важен отрыв по очкам, а не просто порядок мест</p>
                            <p className="text-muted-foreground">
                                Если игроков больше двух, имеет значение разница в очках: победа с отрывом
                                приносит больше рейтинга, чем победа в одно очко. Если один игрок побеждает
                                с большим отрывом, а остальные примерно равны, он получает почти весь заработок.
                                Разрешение ничейной ситуации (tie break) не влияет на формулу — она учитывает
                                только очки, поэтому равный счёт даёт равный заработок независимо от порядка мест.
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-4">
                            <p className="font-semibold mb-1">Стабильность важнее редких всплесков</p>
                            <p className="text-muted-foreground">
                                Рейтинг растёт при стабильном превышении фактического результата над
                                ожидаемым. Начисление за одну партию ограничено коэффициентом{" "}
                                <InlineMath math="K" />, поэтому несколько уверенных побед лучше одной громкой.
                            </p>
                        </CardContent>
                    </Card>
                </div>
            </section>
        </>
    );
}
