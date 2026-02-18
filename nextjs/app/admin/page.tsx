"use client"
import React from "react";
import Link from "next/link";

export default function AdminPage() {
  return (
    <main className="p-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between">
        <h1 className="text-2xl font-semibold mb-4">Админка</h1>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <Link
            href="/admin/users"
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 text-center"
          >
            Управление пользователями
          </Link>
          <Link
            href="/admin/games"
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500 text-center"
          >
            Управление играми
          </Link>
        </div>
      </div>
    </main>
  );
}

