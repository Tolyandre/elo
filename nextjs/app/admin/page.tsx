"use client"
import React from "react";
import Link from "next/link";

export default function AdminPage() {
  return (
    <main className="p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold mb-4">Админка</h1>
        <Link
          href="/admin/users"
          className="ml-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
        >
          Управление пользователями
        </Link>
      </div>
    </main>
  );
}

