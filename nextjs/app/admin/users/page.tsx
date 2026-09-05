"use client"
import type { Base58ID } from "@/lib/id";
import React, { useState } from "react";
import { listUsersPromise, patchUserPromise, User } from "../../api";
import { PageHeader } from "@/app/pageHeaderContext";
import { useMe } from "@/app/meContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { usePlayers } from "@/app/players/PlayersContext";
import { BackButton } from "@/components/back-button";

export default function AdminUsersPage() {
  const { id: currentUserId } = useMe();
  const { players, playerDisplayName } = usePlayers();
  const { data: users, loading, error, invalidate } = useAsyncResource(listUsersPromise);
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [selfRevokeTarget, setSelfRevokeTarget] = useState<User | null>(null);

  // Player display name for every user with a bound player account.
  const playerNameById = new Map(players.map((p) => [p.id, playerDisplayName(p)]));

  async function applyToggle(userId: Base58ID, newValue: boolean) {
    setSavingIds((p) => ({ ...p, [userId]: true }));
    setToggleError(null);
    try {
      await patchUserPromise(userId, { can_edit: newValue });
      invalidate();
    } catch (e) {
      console.error(e);
      setToggleError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingIds((p) => ({ ...p, [userId]: false }));
    }
  }

  function handleToggle(user: User, newValue: boolean) {
    if (!newValue && user.id === currentUserId) {
      setSelfRevokeTarget(user);
      return;
    }
    applyToggle(user.id, newValue);
  }

  function confirmSelfRevoke() {
    if (!selfRevokeTarget) return;
    applyToggle(selfRevokeTarget.id, false);
    setSelfRevokeTarget(null);
  }

  return (
    <main className="p-4 max-w-2xl">
      <PageHeader title="Управление пользователями" />
      <BackButton href="/admin" />

      {loading && <p>Загрузка...</p>}

      {error && (
        <p className="text-sm text-destructive mb-4">{error}</p>
      )}

      {toggleError && (
        <p className="text-sm text-destructive mb-4">{toggleError}</p>
      )}

      {!loading && users && users.length === 0 && <p>Пользователей нет</p>}

      {!loading && users && users.length > 0 && (
        <div className="space-y-1">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between py-3 border-b last:border-0">
              <Label htmlFor={`switch-${u.id}`} className="text-sm font-normal cursor-pointer">
                {u.name}
                {u.player_id && playerNameById.get(u.player_id) && (
                  <span className="block text-xs text-muted-foreground">
                    игрок: {playerNameById.get(u.player_id)}
                  </span>
                )}
              </Label>
              <div className="flex items-center gap-2">
                {savingIds[u.id] && (
                  <span className="text-xs text-muted-foreground">Сохранение...</span>
                )}
                <Switch
                  id={`switch-${u.id}`}
                  checked={u.can_edit}
                  disabled={!!savingIds[u.id]}
                  onCheckedChange={(checked) => handleToggle(u, checked)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!selfRevokeTarget} onOpenChange={(open) => { if (!open) setSelfRevokeTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отозвать права редактирования у себя?</DialogTitle>
            <DialogDescription>
              Вы собираетесь снять с себя право редактирования. После этого вы не сможете
              самостоятельно вернуть его — потребуется помощь другого администратора.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelfRevokeTarget(null)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={confirmSelfRevoke}>
              Отозвать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
