"use client"
import React from "react";
import { PageHeader } from "@/app/pageHeaderContext";
import { useMe } from "@/app/meContext";
import { AuthWarning } from "@/components/auth-warning";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { GlobalReplayReport, PlayerGlobalStateChange, recalculateGlobalEloPromise } from "../api";
import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react";

/**
 * Debug/monitoring page. Deliberately not linked from the site navigation —
 * reached by typing the URL. Requires edit permission (also enforced by the
 * backend route middleware).
 */

/** Full-precision rendering: even float-level drift must stay visible. */
function formatValue(v: number): string {
  return String(v);
}

function ValueDiff({ before, after }: { before: number; after: number }) {
  if (before === after) return <span className="tabular-nums">{formatValue(before)}</span>;
  return (
    <span className="tabular-nums">
      {formatValue(before)} <span className="text-muted-foreground">→</span>{" "}
      <span className="font-medium text-destructive">{formatValue(after)}</span>
    </span>
  );
}

function LeagueDiff({ before, after }: { before: string; after: string }) {
  if (before === after) return <span>{before || "—"}</span>;
  return (
    <span>
      {before || "—"} <span className="text-muted-foreground">→</span>{" "}
      <span className="font-medium text-destructive">{after || "—"}</span>
    </span>
  );
}

function ChangeRow({ change }: { change: PlayerGlobalStateChange }) {
  return (
    <tr className="border-b">
      <td className="px-2 py-1.5">{change.player_name}</td>
      <td className="px-2 py-1.5">
        <ValueDiff before={change.elo_before} after={change.elo_after} />
      </td>
      <td className="px-2 py-1.5">
        <ValueDiff before={change.rating_before} after={change.rating_after} />
      </td>
      <td className="px-2 py-1.5">
        <LeagueDiff before={change.league_before} after={change.league_after} />
      </td>
    </tr>
  );
}

export default function DebugPage() {
  const me = useMe();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [report, setReport] = React.useState<GlobalReplayReport | null>(null);

  async function runRecalc(): Promise<boolean> {
    setRunning(true);
    try {
      setReport(await recalculateGlobalEloPromise());
      return true;
    } catch {
      // error toast already shown by the API layer
      return false;
    } finally {
      setRunning(false);
    }
  }

  const changed = report?.changed_players ?? [];

  return (
    <main className="p-4 max-w-2xl mx-auto space-y-4">
      <PageHeader title="Debug" />

      <Card>
        <CardHeader>
          <CardTitle>Полный пересчёт рейтингов</CardTitle>
          <CardDescription>
            Повторно применяет все партии, коррекции и расчёты рынков с самого начала — тот же
            расчёт, что запускается при сохранении самой первой партии без изменений. Стабильный
            пересчёт не должен менять рейтинги: любые расхождения ниже — признак ошибки.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <AuthWarning />
          <Button disabled={!me.canEdit || running} onClick={() => setConfirmOpen(true)}>
            Пересчитать всё
          </Button>
        </CardContent>
      </Card>

      {report && (
        <Card>
          <CardHeader>
            <CardTitle>Результат</CardTitle>
            <CardDescription>
              Переиграно партий: {report.matches_replayed}, коррекций: {report.corrections_replayed}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {changed.length === 0 ? (
              <Alert>
                <CheckCircle2Icon />
                <AlertTitle>Расхождений нет</AlertTitle>
                <AlertDescription>
                  Повторный пересчёт воспроизвёл те же глобальные рейтинги.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertTitle>Обнаружены расхождения: {changed.length}</AlertTitle>
                  <AlertDescription>
                    Повторный пересчёт изменил глобальный рейтинг перечисленных игроков.
                  </AlertDescription>
                </Alert>
                <div className="overflow-x-auto">
                  <table className="w-full table-auto border-collapse text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="px-2 py-1.5 font-medium">Игрок</th>
                        <th className="px-2 py-1.5 font-medium">Elo</th>
                        <th className="px-2 py-1.5 font-medium">Рейтинг</th>
                        <th className="px-2 py-1.5 font-medium">Лига</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changed.map((c) => (
                        <ChangeRow key={c.player_id} change={c} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Пересчитать все рейтинги?"
        description="Полный повтор истории расчётов может занять время. Итог покажет, изменились ли чьи-то рейтинги."
        confirmText="Пересчитать"
        loading={running}
        onConfirm={async () => {
          if (await runRecalc()) setConfirmOpen(false);
        }}
      />
    </main>
  );
}
