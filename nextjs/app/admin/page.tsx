"use client"
import React from "react";
import Link from "next/link";
import { PageHeader } from "@/app/pageHeaderContext";

export default function AdminPage() {
  return (
    <main className="p-4 max-w-sm mx-auto">
      <PageHeader title="Админка" />

      {/* <div className="flex flex-col items-start"> */}
      <div className="flex flex-col items-center">
        <div className="flex flex-col gap-2 w-full max-w-xs">
          <Link
            href="/admin/users"
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 text-center"
          >
            Пользователи
          </Link>
          <Link
            href="/admin/players"
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-500 text-center"
          >
            Игроки
          </Link>
          <Link
            href="/admin/games"
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500 text-center"
          >
            Игры
          </Link>
          <Link
            href="/admin/clubs"
            className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-500 text-center"
          >
            Клубы
          </Link>
          <Link
            href="/admin/markets"
            className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-500 text-center"
          >
            Рынки ставок
          </Link>
          <Link
            href="/admin/formula"
            className="px-4 py-2 bg-teal-600 text-white rounded hover:bg-teal-500 text-center"
          >
            Настройка формулы Elo
          </Link>
        </div>
      </div>
    </main>
  );
}

