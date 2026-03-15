"use client"
import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
    EloSettingEntry,
    listAllSettingsPromise,
    createSettingsPromise,
    deleteSettingsPromise,
} from "@/app/api";
import { useMe } from "@/app/meContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

function formatDate(dateStr: string): string {
    if (dateStr === "-infinity") return "Начальная";
    try {
        return new Date(dateStr).toLocaleDateString("ru-RU", {
            year: "numeric", month: "long", day: "numeric",
            hour: "2-digit", minute: "2-digit",
        });
    } catch {
        return dateStr;
    }
}

function isCurrentEntry(entry: EloSettingEntry, entries: EloSettingEntry[]): boolean {
    const now = new Date();
    let current: EloSettingEntry | null = null;
    for (const e of entries) {
        if (e.effective_date === "-infinity") {
            if (!current) current = e;
            continue;
        }
        const d = new Date(e.effective_date);
        if (d <= now) {
            if (!current || current.effective_date === "-infinity" || new Date(current.effective_date) < d) {
                current = e;
            }
        }
    }
    return current === entry;
}

function isFutureEntry(entry: EloSettingEntry): boolean {
    if (entry.effective_date === "-infinity") return false;
    return new Date(entry.effective_date) > new Date();
}

export default function FormulaAdminPage() {
    const { canEdit } = useMe();
    const [entries, setEntries] = useState<EloSettingEntry[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [deletingDate, setDeletingDate] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    // Form state
    const [formDate, setFormDate] = useState("");
    const [formK, setFormK] = useState("32");
    const [formD, setFormD] = useState("400");
    const [formStartingElo, setFormStartingElo] = useState("1000");
    const [formWinReward, setFormWinReward] = useState("1");

    function load() {
        setLoading(true);
        listAllSettingsPromise()
            .then(setEntries)
            .catch(() => { })
            .finally(() => setLoading(false));
    }

    useEffect(() => { load(); }, []);

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        const winRewardVal = parseFloat(formWinReward);
        if (isNaN(winRewardVal) || winRewardVal < 0.1 || winRewardVal > 5) {
            alert("WinReward должен быть от 0.1 до 5");
            return;
        }
        try {
            setCreating(true);
            await createSettingsPromise({
                effective_date: new Date(formDate).toISOString(),
                elo_const_k: parseFloat(formK),
                elo_const_d: parseFloat(formD),
                starting_elo: parseFloat(formStartingElo),
                win_reward: winRewardVal,
            });
            setFormDate("");
            load();
        } catch {
            // toast shown by API helper
        } finally {
            setCreating(false);
        }
    }

    async function handleDelete(effectiveDate: string) {
        if (!confirm("Удалить запланированную настройку?")) return;
        try {
            setDeletingDate(effectiveDate);
            await deleteSettingsPromise(effectiveDate);
            load();
        } catch {
            // toast shown by API helper
        } finally {
            setDeletingDate(null);
        }
    }

    // Min date: now + 1 minute
    const minDate = new Date();
    minDate.setMinutes(minDate.getMinutes() + 1);
    const minDateStr = minDate.toISOString().slice(0, 16);

    return (
        <main className="p-4 max-w-3xl">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-semibold">Настройка формулы Elo</h1>
                <Button variant="link" asChild className="px-0">
                    <Link href="/admin">Назад</Link>
                </Button>
            </div>

            {loading && <p>Загрузка...</p>}

            {!loading && entries && (() => {
                const current = entries.find((e) => isCurrentEntry(e, entries)) ?? null;
                return (
                    <Card className="mb-6">
                        <CardHeader>
                            <CardTitle>Действующая формула</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {current ? (
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <p className="font-medium">K = {current.elo_const_k}</p>
                                        <p className="text-muted-foreground text-xs mt-0.5">Волатильность — насколько сильно одна партия меняет рейтинг</p>
                                    </div>
                                    <div>
                                        <p className="font-medium">D = {current.elo_const_d}</p>
                                        <p className="text-muted-foreground text-xs mt-0.5">Масштаб — при разнице в D пунктов более сильный побеждает в 91% случаев</p>
                                    </div>
                                    <div>
                                        <p className="font-medium">Нач. Elo = {current.starting_elo}</p>
                                        <p className="text-muted-foreground text-xs mt-0.5">Стартовый рейтинг новых игроков</p>
                                    </div>
                                    <div>
                                        <p className="font-medium">Win Reward = {current.win_reward}</p>
                                        <p className="text-muted-foreground text-xs mt-0.5">Степень нормализации очков — при W&gt;1 победители получают непропорционально большую долю рейтинга</p>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sm text-muted-foreground">Нет активной настройки</p>
                            )}
                        </CardContent>
                    </Card>
                );
            })()}

            {canEdit && (
                <Card className="mb-6">
                    <CardHeader>
                        <CardTitle>Изменить формулу</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground mb-4">
                            Новые настройки вступят в силу с указанной даты
                        </p>
                        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="sm:col-span-2">
                                <Label htmlFor="formDate">Дата</Label>
                                <input
                                    id="formDate"
                                    type="datetime-local"
                                    className="mt-1 border rounded-md p-2 w-full bg-background text-foreground"
                                    value={formDate}
                                    min={minDateStr}
                                    onChange={(e) => setFormDate(e.target.value)}
                                    required
                                />
                            </div>
                            <div>
                                <Label htmlFor="formK">K — волатильность</Label>
                                <input
                                    id="formK"
                                    type="number"
                                    className="mt-1 border rounded-md p-2 w-full bg-background text-foreground"
                                    value={formK}
                                    step="1"
                                    min="1"
                                    max="100"
                                    onChange={(e) => setFormK(e.target.value)}
                                    required
                                />
                            </div>
                            <div>
                                <Label htmlFor="formD">D — масштаб</Label>
                                <input
                                    id="formD"
                                    type="number"
                                    className="mt-1 border rounded-md p-2 w-full bg-background text-foreground"
                                    value={formD}
                                    step="1"
                                    min="100"
                                    max="800"
                                    onChange={(e) => setFormD(e.target.value)}
                                    required
                                />
                            </div>
                            <div>
                                <Label htmlFor="formStartingElo">Начальный Elo</Label>
                                <input
                                    id="formStartingElo"
                                    type="number"
                                    className="mt-1 border rounded-md p-2 w-full bg-background text-foreground"
                                    value={formStartingElo}
                                    step="1"
                                    min="0"
                                    onChange={(e) => setFormStartingElo(e.target.value)}
                                    required
                                />
                            </div>
                            <div>
                                <Label htmlFor="formWinReward">W — Win Reward</Label>
                                <input
                                    id="formWinReward"
                                    type="number"
                                    className="mt-1 border rounded-md p-2 w-full bg-background text-foreground"
                                    value={formWinReward}
                                    step="0.1"
                                    min="0.1"
                                    max="5"
                                    onChange={(e) => setFormWinReward(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <Button type="submit" disabled={creating}>
                                    {creating ? "Сохранение..." : "Запланировать"}
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            )}

            {!loading && entries && (
                <Card className="mb-6">
                    <CardHeader>
                        <CardTitle>История</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {/* Desktop table */}
                        <div className="hidden sm:block">
                            <table className="w-full text-sm border-collapse">
                                <thead>
                                    <tr className="text-left text-muted-foreground border-b">
                                        <th className="pb-2 pr-4 font-medium">Дата</th>
                                        <th className="pb-2 pr-4 font-medium">K</th>
                                        <th className="pb-2 pr-4 font-medium">D</th>
                                        <th className="pb-2 pr-4 font-medium">Нач. Elo</th>
                                        <th className="pb-2 pr-4 font-medium">Win Reward</th>
                                        <th className="pb-2 font-medium"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {entries.map((entry) => {
                                        const isCurrent = isCurrentEntry(entry, entries);
                                        const isFuture = isFutureEntry(entry);
                                        return (
                                            <tr
                                                key={entry.effective_date}
                                                className={`border-b ${isCurrent ? "font-semibold" : ""}`}
                                            >
                                                <td className="py-2 pr-4">
                                                    <span>{formatDate(entry.effective_date)}</span>
                                                    {isCurrent && (
                                                        <Badge className="ml-2 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 hover:bg-green-100">
                                                            Действует
                                                        </Badge>
                                                    )}
                                                    {isFuture && (
                                                        <Badge className="ml-2 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 hover:bg-blue-100">
                                                            Запланировано
                                                        </Badge>
                                                    )}
                                                </td>
                                                <td className="py-2 pr-4">{entry.elo_const_k}</td>
                                                <td className="py-2 pr-4">{entry.elo_const_d}</td>
                                                <td className="py-2 pr-4">{entry.starting_elo}</td>
                                                <td className="py-2 pr-4">{entry.win_reward}</td>
                                                <td className="py-2">
                                                    {isFuture && canEdit && (
                                                        <Button
                                                            variant="destructive"
                                                            size="sm"
                                                            onClick={() => handleDelete(entry.effective_date)}
                                                            disabled={deletingDate === entry.effective_date}
                                                        >
                                                            {deletingDate === entry.effective_date ? "Удаление..." : "Удалить"}
                                                        </Button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile cards */}
                        <div className="sm:hidden space-y-3">
                            {entries.map((entry) => {
                                const isCurrent = isCurrentEntry(entry, entries);
                                const isFuture = isFutureEntry(entry);
                                return (
                                    <div
                                        key={entry.effective_date}
                                        className={`rounded-lg border p-3 ${isCurrent ? "border-green-300 dark:border-green-700" : ""}`}
                                    >
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <span className={`text-sm ${isCurrent ? "font-semibold" : ""}`}>
                                                    {formatDate(entry.effective_date)}
                                                </span>
                                                {isCurrent && (
                                                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 hover:bg-green-100">
                                                        Действует
                                                    </Badge>
                                                )}
                                                {isFuture && (
                                                    <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 hover:bg-blue-100">
                                                        Запланировано
                                                    </Badge>
                                                )}
                                            </div>
                                            {isFuture && canEdit && (
                                                <Button
                                                    variant="destructive"
                                                    size="sm"
                                                    onClick={() => handleDelete(entry.effective_date)}
                                                    disabled={deletingDate === entry.effective_date}
                                                    className="shrink-0"
                                                >
                                                    {deletingDate === entry.effective_date ? "Удаление..." : "Удалить"}
                                                </Button>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                                            <span className="text-muted-foreground">K</span>
                                            <span>{entry.elo_const_k}</span>
                                            <span className="text-muted-foreground">D</span>
                                            <span>{entry.elo_const_d}</span>
                                            <span className="text-muted-foreground">Нач. Elo</span>
                                            <span>{entry.starting_elo}</span>
                                            <span className="text-muted-foreground">Win Reward</span>
                                            <span>{entry.win_reward}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>
            )}
        </main>
    );
}
