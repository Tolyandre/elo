"use client"
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { listUsersPromise, patchUserPromise, User } from "../../api";
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

export default function AdminUsersPage() {
  const { id: currentUserId } = useMe();
  const [users, setUsers] = useState<User[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [selfRevokeTarget, setSelfRevokeTarget] = useState<User | null>(null);

  useEffect(() => {
    setLoading(true);
    listUsersPromise()
      .then((data) => setUsers(data))
      .catch((e) => {
        console.error(e);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, []);

  async function applyToggle(userId: string, newValue: boolean) {
    setSavingIds((p) => ({ ...p, [userId]: true }));
    setError(null);
    try {
      await patchUserPromise(userId, { can_edit: newValue });
      setUsers((prev) =>
        prev ? prev.map((u) => (u.id === userId ? { ...u, can_edit: newValue } : u)) : prev
      );
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Управление пользователями</h1>
        <Button variant="link" asChild className="px-0">
          <Link href="/admin">Назад</Link>
        </Button>
      </div>

      {loading && <p>Загрузка...</p>}

      {error && (
        <p className="text-sm text-destructive mb-4">{error}</p>
      )}

      {!loading && users && users.length === 0 && <p>Пользователей нет</p>}

      {!loading && users && users.length > 0 && (
        <div className="space-y-1">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between py-3 border-b last:border-0">
              <Label htmlFor={`switch-${u.id}`} className="text-sm font-normal cursor-pointer">
                {u.name}
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
