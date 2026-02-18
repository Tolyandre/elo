"use client"
import React from "react";
import Link from "next/link";

export default function AdminPage() {
  return (
    <main className="p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold mb-4">Админка</h1>
        <div className="flex items-center">
          <Link
            href="/admin/users"
            className="ml-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
          >
            Управление пользователями
          </Link>
          <Link
            href="/admin/games"
            className="ml-4 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500"
          >
            Управление играми
          </Link>
        </div>
      </div>
    </main>
  );
}

