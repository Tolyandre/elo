"use client"
import { Game, getGamePromise } from "@/app/api";
import { useSearchParams } from "next/navigation";
import React, { Suspense } from "react";
import { useEffect, useState } from "react";

export default function GamePage() {
  return (
    <Suspense>
      <GameWrapped />
    </Suspense>
  )
}

function GameWrapped() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id')

  if (!id) {
    return (
      <main className="space-y-8">
        <h1 className="text-2xl font-semibold mb-4">Missing game id</h1>
        <p className="text-gray-600">Please provide a game id in the query string, e.g. ?id=GAME_ID</p>
      </main>
    );
  }

  const [game, setGame] = useState<Game | null>(null);

  useEffect(() => {
    getGamePromise(id)
      .then((data) => {
        setGame(data);
      });
  }, [id]);

  return (
    <main className="space-y-8">
      <h1 className="text-2xl font-semibold mb-4">{game?.id}</h1>
      <p className="text-gray-600">Партий сыграно: {game?.total_matches}</p>
    </main>
  );

}


