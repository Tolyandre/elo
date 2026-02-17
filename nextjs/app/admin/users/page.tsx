"use client"
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { listUsersPromise, patchUserPromise, User } from "../../api";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLoading(true);
    listUsersPromise()
      .then((data) => setUsers(data))
      .catch((e) => {
        console.error(e);
        alert(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, []);

  async function toggleCanEdit(userId: string, newValue: boolean) {
    setSavingIds((p) => ({ ...p, [userId]: true }));
    try {
      await patchUserPromise(userId, { can_edit: newValue });
      setUsers((prev) =>
        prev ? prev.map((u) => (u.id === userId ? { ...u, can_edit: newValue } : u)) : prev
      );
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingIds((p) => ({ ...p, [userId]: false }));
    }
  }

  return (
    <main className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Управление пользователями</h1>
        <Link href="/admin" className="text-sm text-blue-600">
          Назад
        </Link>
      </div>

      {loading && <div>Загрузка...</div>}

      {!loading && users && (
        <table className="w-full table-auto border-collapse">
          <thead>
            <tr>
              <th className="text-left py-2">Имя</th>
              <th className="text-left py-2">Может редактировать</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="py-2">{u.name}</td>
                <td className="py-2">
                  <label className="inline-flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={u.can_edit}
                      disabled={!!savingIds[u.id]}
                      onChange={(e) => toggleCanEdit(u.id, e.target.checked)}
                    />
                    {savingIds[u.id] && <span className="text-sm text-gray-500">Сохранение...</span>}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && users && users.length === 0 && <div>Пользователей нет</div>}
    </main>
  );
}
