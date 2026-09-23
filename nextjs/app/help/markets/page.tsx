"use client"

import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/app/pageHeaderContext"
import { BlockMath, InlineMath } from "../math"
import { AnchorHeading } from "../anchor-heading"
import { MarketPlayground } from "./market-playground"

export default function HelpMarketsPage() {
    return (
        <>
            <PageHeader title="Рынок предсказаний" />
            <p className="text-sm leading-relaxed">
                Рынок предсказаний («Ставки») — это пари на рейтинг вокруг событий приложения.
                Это сознательная пародия на площадки предсказаний вроде Polymarket и на
                тотализатор: только вместо денег используется рейтинг Эло.
            </p>

            {/* ── Принцип работы ── */}
            <section className="space-y-4 text-sm leading-relaxed">
                <AnchorHeading id="idea">Принцип работы</AnchorHeading>
                <p>
                    На рынок выставляется событие с несколькими возможными исходами. Игроки
                    ставят рейтинг на исходы, рынок двигает цены-вероятности, а когда событие
                    завершается, рынок рассчитывается: сбывшийся исход приносит выплату.
                </p>
                <p>
                    Ключевой принцип: <strong>голос — это доля в исходе, и каждый голос
                    сбывшегося исхода платит ровно 1 рейтинг</strong>. Цена голоса равна текущей
                    вероятности исхода: чем исход вероятнее, тем голос дороже, а чем он
                    маловероятнее — тем дешевле голос и выше множитель ставки. Ставка всегда
                    фиксированная — 1 рейтинга: кнопка «Поставить 1» обменивает эту сумму на
                    голоса по текущей цене, включая комиссию.
                </p>
                <p>
                    Выигрыши платит не «казино». Источник выплаты — ставки всех участников:
                    голоса сбывшегося исхода оплачиваются в том числе проигравшими ставками.
                    Разницу закрывают <strong>поручители</strong> — игроки, заранее обеспечившие
                    рынок своим рейтингом: если собранных ставок не хватило на выплаты, убыток
                    достаётся им, а если хватило с избытком — разница и комиссия уходят им же.
                    Взамен они получают комиссию с каждой ставки. Пока первого поручителя нет,
                    рынок ждёт: ставки откроются только тогда, когда есть чем платить выигрыши.
                </p>
                <p>
                    Сумма всех изменений рейтинга на рынке всегда равна нулю: проигранные
                    ставки в точности распределяются между победителями и поручителями.
                </p>
            </section>

            {/* ── Типы рынков ── */}
            <section className="space-y-4 text-sm leading-relaxed">
                <AnchorHeading id="types">Типы рынков</AnchorHeading>
                <p>События создаёт администратор; тип определяет, откуда рынок берёт исходы и как узнаёт о расчёте.</p>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2 pr-4">Тип</th>
                                <th className="text-left py-2">Событие и исходы</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            <tr>
                                <td className="py-2 pr-4 font-medium">Исход партии</td>
                                <td className="py-2 text-muted-foreground">
                                    Кто выиграет конкретную партию. Исходы — участники (и «Кто-то другой»,
                                    если разрешено). Рассчитывается автоматически по результату партии.
                                </td>
                            </tr>
                            <tr>
                                <td className="py-2 pr-4 font-medium">Серия побед</td>
                                <td className="py-2 text-muted-foreground">
                                    Выиграет ли игрок N партий подряд до того, как потерпит M поражений.
                                    Прогресс серии виден прямо на странице рынка.
                                </td>
                            </tr>
                            <tr>
                                <td className="py-2 pr-4 font-medium">Победитель турнира</td>
                                <td className="py-2 text-muted-foreground">
                                    Кто станет чемпионом турнира. Исходы — участники; расчёт происходит,
                                    когда финал турнира определит победителя.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p>
                    Рынок проходит статусы <em>открыт → ставки закрыты → разрешён</em>. Если событие
                    не состоялось или рынок отменён, все ставки возвращаются полностью — и
                    поставленная сумма, и комиссия.
                </p>
            </section>

            {/* ── Термины ── */}
            <section className="space-y-4 text-sm leading-relaxed">
                <AnchorHeading id="terms">Термины</AnchorHeading>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2 pr-4">Термин</th>
                                <th className="text-left py-2">Значение</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y text-muted-foreground">
                            <tr>
                                <td className="py-2 pr-4 font-medium text-foreground">Исход</td>
                                <td className="py-2">
                                    Один из возможных результатов события. Исходы взаимоисключающие:
                                    сбывается ровно один, поэтому сумма вероятностей всех исходов всегда 100%.
                                </td>
                            </tr>
                            <tr>
                                <td className="py-2 pr-4 font-medium text-foreground">Вероятность = цена</td>
                                <td className="py-2">
                                    Вероятность исхода <InlineMath math="p" /> — это и есть цена голоса — но
                                    строго говоря, лишь первой бесконечно малой его доли: покупка ощутимого
                                    количества голосов сама двигает цену вверх, поэтому средняя цена покупки
                                    выше текущей вероятности (см. «Алгоритм маркет-мейкера»). Диаграмма и
                                    график истории показывают именно эту цену.
                                </td>
                            </tr>
                            <tr>
                                <td className="py-2 pr-4 font-medium text-foreground">Голос</td>
                                <td className="py-2">Доля в исходе. Каждый голос сбывшегося исхода приносит 1 рейтинг; голоса остальных исходов сгорают.</td>
                            </tr>
                            <tr>
                                <td className="py-2 pr-4 font-medium text-foreground">Ставка</td>
                                <td className="py-2">Фиксированные 1 рейтинга, которые обмениваются на голоса по текущей цене (в тренажёре — 1, 2 или 5).</td>
                            </tr>
                            <tr>
                                <td className="py-2 pr-4 font-medium text-foreground">Комиссия рынка <InlineMath math="c" /></td>
                                <td className="py-2">
                                    Надбавка к цене голоса, которая целиком идёт поручителям. Задаётся
                                    поручителями, 0–25%: это доля от выплаты за голос (1 рейтинг),
                                    которую надбавка достигает в максимуме — при цене 0,5; у краёв она
                                    меньше. Экономически это <em>комиссия маркет-мейкера</em> (maker fee):
                                    платёж покупателя тому, кто предоставил ликвидность.
                                </td>
                            </tr>
                            <tr>
                                <td className="py-2 pr-4 font-medium text-foreground">Поручитель</td>
                                <td className="py-2">Игрок, обеспечивший рынок своим рейтингом под комиссию. Без первого поручителя рынок не открывается.</td>
                            </tr>
                            <tr>
                                <td className="py-2 pr-4 font-medium text-foreground">Риск поручителя</td>
                                <td className="py-2">Максимум, который поручитель может потерять. Резервируется против его кредитного лимита ставок.</td>
                            </tr>
                            <tr>
                                <td className="py-2 pr-4 font-medium text-foreground">Максимальный риск <InlineMath math="L" /></td>
                                <td className="py-2">Параметр рынка: суммарная волатильность рынка ограничена величиной <InlineMath math="b\ln n \le L" />.</td>
                            </tr>
                            <tr>
                                <td className="py-2 pr-4 font-medium text-foreground">Ликвидность <InlineMath math="b" /></td>
                                <td className="py-2">Параметр, определяющий, насколько резко цены двигаются от ставок: большой b — цены инертные, малый — резкие.</td>
                            </tr>
                            <tr>
                                <td className="py-2 pr-4 font-medium text-foreground">Кредитный лимит</td>
                                <td className="py-2">Максимум суммарных ставок игрока; зависит от его рейтинга. Риск поручителя входит в этот лимит.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            {/* ── Поручители ── */}
            <section className="space-y-4 text-sm leading-relaxed">
                <AnchorHeading id="guarantors">Роль поручителей</AnchorHeading>
                <p>
                    Поручители — добровольные поставщики ликвидности, аналог маркет-мейкеров
                    на бирже. Они одалживают рынку риск: из обеспеченного рейтинга платятся
                    выигрыши по сбывшимся голосам, а комбинация рисков всех поручителей задаёт
                    ликвидность <InlineMath math="b" /> — то, насколько плавно рынок реагирует на ставки.
                </p>
                <p>
                    Стать поручителем — значит указать <strong>риск</strong> (максимальную потерю,
                    которая резервируется против кредитного лимита) и <strong>комиссию</strong> от 0 до 25%.
                    Комиссия определяет сразу две вещи: долю поручителя в собранных комиссиях
                    и его место в «водопаде убытков». Рынок берёт средневзвешенную по риску
                    комиссию всех поручителей и добавляет её к цене каждого голоса.
                </p>
                <p>
                    Надбавка зависит от цены: она максимальна при цене 0,5 и убывает к краям.
                    Например, при комиссии 5% голос за 0,5 обойдётся в 0,55 (+5% от выплаты),
                    а при цене 0,8 — в 0,832 (+3,2% от выплаты).
                </p>
                <p>
                    Когда поручитель присоединяется к уже работающему рынку, ликвидность{" "}
                    <InlineMath math="b" /> пересчитывается при неизменных позициях — все цены
                    сдвигаются к равномерным: рынок становится «глубже», а старые позиции
                    сохраняют свою стоимость.
                </p>
            </section>

            {/* ── Алгоритм маркет-мейкера ── */}
            <section className="space-y-4 text-sm leading-relaxed">
                <AnchorHeading id="maker">Алгоритм маркет-мейкера</AnchorHeading>
                <p>
                    Цены задаёт <strong>LMSR</strong> — логарифмическая функция рыночного оценки
                    (logarithmic market scoring rule), стандартный алгоритм рынков предсказаний.
                    У рынка есть вектор позиций <InlineMath math="q = (q_1, \dots, q_n)" /> — по числу купленных
                    голосов на каждый исход — и ликвидность <InlineMath math="b" />.
                </p>
                <p>Стоимость позиций <InlineMath math="q" />:</p>
                <Card className="bg-muted/50">
                    <CardContent className="py-3 overflow-x-auto">
                        <BlockMath math={String.raw`C(q) = b \cdot \ln\!\Bigl(\sum_{j} e^{q_j / b}\Bigr)`} />
                    </CardContent>
                </Card>
                <p>Вероятность (цена) исхода <InlineMath math="i" /> — производная стоимости по <InlineMath math="q_i" />:</p>
                <Card className="bg-muted/50">
                    <CardContent className="py-3 overflow-x-auto">
                        <BlockMath math={String.raw`p_i = \frac{e^{q_i / b}}{\sum_j e^{q_j / b}}, \qquad \sum_i p_i = 1`} />
                    </CardContent>
                </Card>
                <p>
                    Покупка <InlineMath math="s" /> голосов исхода <InlineMath math="i" /> двигает только{" "}
                    <InlineMath math="q_i" /> и стоит разницу стоимостей:
                </p>
                <Card className="bg-muted/50">
                    <CardContent className="py-3 overflow-x-auto">
                        <BlockMath math={String.raw`\text{стоимость}(s) = C(q + s \cdot e_i) - C(q)`} />
                    </CardContent>
                </Card>
                <p>
                    LMSR обладает удобным свойством <em>независимости от пути</em>: купить все
                    голоса одной ставкой стоит ровно столько же, сколько покупать их по одной.
                    По мере роста <InlineMath math="q_i" /> цена исхода растёт от 0 к 1 — каждая покупка
                    делает следующий голос дороже, поэтому обвалить рынок дёшево нельзя.
                </p>
                <p>
                    Сверху добавляется комиссия поручителей <InlineMath math="c" />. Цена голоса для
                    покупателя становится <InlineMath math="p_u = p + 4c\,p(1-p)" /> — надбавка
                    пропорциональна дисперсии исхода: максимум <InlineMath math="c" /> при{" "}
                    <InlineMath math="p = 0{,}5" />, ноль на краях. Комиссия за всю покупку имеет
                    замкнутую форму <InlineMath math={String.raw`4c\,b\,\Delta p_i`} />:
                </p>
                <Card className="bg-muted/50">
                    <CardContent className="py-3 overflow-x-auto space-y-1">
                        <BlockMath math={String.raw`p_u = p + 4c \cdot p(1-p)`} />
                        <BlockMath math={String.raw`\text{комиссия} = \int_0^{s} 4c \cdot p_i(1-p_i)\, dq_i = 4c \cdot b \cdot \Delta p_i`} />
                    </CardContent>
                </Card>
                <p>
                    <strong>Вероятность ≠ стоимость.</strong> На диаграмме и в заголовке карточки
                    показывается вероятность (цена), но покупка платит стоимость по формуле выше
                    плюс комиссию. В тонком рынке (малый <InlineMath math="b" />) даже первый голос
                    стоит заметно дороже открывающей вероятности — это плата за движение цены.
                </p>
            </section>

            {/* ── Формулы поручителей ── */}
            <section className="space-y-4 text-sm leading-relaxed">
                <AnchorHeading id="guarantor-math">Формулы рынка и поручителей</AnchorHeading>

                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
                    Ликвидность и комиссия рынка
                </p>
                <p>
                    Пусть у рынка <InlineMath math="n" /> исходов, поручители рискуют суммами{" "}
                    <InlineMath math="r_k" /> под комиссии <InlineMath math="f_k" />. Тогда:
                </p>
                <Card className="bg-muted/50">
                    <CardContent className="py-3 overflow-x-auto space-y-1">
                        <BlockMath math={String.raw`b = \frac{\min(L,\; \sum_k r_k)}{\ln n}`} />
                        <BlockMath math={String.raw`c = \frac{\sum_k f_k \, r_k}{\sum_k r_k}`} />
                    </CardContent>
                </Card>
                <p>
                    Минимум с <InlineMath math="L" /> ограничивает волатильность: худший случай для
                    поручителей — <InlineMath math="b \ln n \le L" />. Когда суммарный риск растёт
                    сверх <InlineMath math="L" />, ликвидность больше не увеличивается.
                </p>

                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
                    Расчёт рынка
                </p>
                <p>
                    Каждый голос сбывшегося исхода платит 1. Пусть{" "}
                    <InlineMath math={String.raw`\text{собрано}`} /> — суммы всех ставок без
                    комиссий, <InlineMath math={String.raw`\text{выплачено}`} /> — голоса
                    победителей, <InlineMath math={String.raw`\text{комиссии}`} /> — собранные
                    комиссии. Остаток рынка:
                </p>
                <Card className="bg-muted/50">
                    <CardContent className="py-3 overflow-x-auto">
                        <BlockMath math={String.raw`\text{остаток} = \text{собрано} - \text{выплачено}`} />
                    </CardContent>
                </Card>
                <p>
                    Поручители получают два котла: <strong>пул комиссий</strong> (все{" "}
                    <InlineMath math={String.raw`\text{комиссии}`} />) и <strong>остаток</strong> — с прибылью или убытком.
                </p>

                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
                    Пул комиссий: атрибуция по времени
                </p>
                <p>
                    Комиссия каждой ставки делится только между поручителями, которые
                    присоединились не позже этой ставки, пропорционально{" "}
                    <InlineMath math={String.raw`f_k r_k`} />. Поздний поручитель не может
                    пользоваться комиссиями, собранными до его входа.
                </p>

                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
                    Прибыль: делёж по экспозиции
                </p>
                <p>
                    Прибыль делится пропорционально накопленной экспозиции: позиция поручителя
                    «работала», пока рынок торговал. В момент каждой ставки активные поручители
                    получают начисление пропорционально риску от величины
                </p>
                <Card className="bg-muted/50">
                    <CardContent className="py-3 overflow-x-auto">
                        <BlockMath math={String.raw`V = \max\!\Bigl(\max_i Q_i - \text{собрано},\; 0{,}1 \cdot \min(L,\; \Sigma r_{\text{активных}})\Bigr)`} />
                    </CardContent>
                </Card>
                <p>
                    где <InlineMath math="Q_i" /> — текущие позиции рынка. Первое слагаемое —
                    непокрытая ответственность рынка (сколько должен, сверх собранного);
                    второе — «дежурная» ставка 10% от ликвидности: даже спокойный рынок
                    приносит поручителям скромную ренту пропорционально обеспеченным сделкам.
                </p>

                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
                    Убыток: водопад
                </p>
                <p>
                    Если рынок убыточен, убыток покрывается каскадом. Сначала платят
                    поручители с комиссией — пропорционально{" "}
                    <InlineMath math={String.raw`f_k r_k`} />, но не больше своего риска. Если их
                    не хватило, остаток покрывают все остальные пропорционально оставшемуся
                    риску. Поручители с нулевой комиссией — «старшая транша»: они платят
                    последними и в обмен не получают комиссий.
                </p>
                <p>
                    Инвариант всего расчёта — строгий ноль: сколько игроки потеряли, ровно
                    столько получают победители и поручители. Один и тот же поток ставок
                    всегда даёт одинаковый расчёт, вплоть до копеек.
                </p>
            </section>

            {/* ── Интерактивный рынок ── */}
            <section className="space-y-4 text-sm leading-relaxed">
                <AnchorHeading id="playground">Интерактивный рынок</AnchorHeading>
                <p>
                    Тренажёр ниже использует настоящие алгоритмы рынка — те же функции, что
                    и страница ставок. Настройте рынок, играйте за разных игроков, ставьте
                    или становитесь поручителем, следите за историей вероятностей, а затем
                    выберите сбывшийся исход и посмотрите выплаты.
                </p>
                <MarketPlayground />
            </section>
        </>
    );
}
