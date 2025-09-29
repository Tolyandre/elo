"use client";

import React, { useEffect, useState } from "react";

type Player = {
  id: string;
  elo: number;
};

type Participant = {
  id: string;
  points: number;
};

export default function AddGamePage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [gameName, setGameName] = useState("");
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch("https://toly.is-cool.dev/elo-web-service/players")
      .then((res) => res.json())
      .then((data) => setPlayers(data))
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = (id: string, checked: boolean) => {
    if (checked) {
      setParticipants([...participants, { id, points: 0 }]);
    } else {
      setParticipants(participants.filter((p) => p.id !== id));
    }
  };

  const handlePointsChange = (id: string, points: number) => {
    setParticipants(
      participants.map((p) =>
        p.id === id ? { ...p, points } : p
      )
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gameName.trim()) return;
    // TODO: Replace with your API endpoint for submitting game results
    // Example POST request:
    /*
    await fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameName, participants }),
    });
    */
    setSuccess(true);
  };

  if (loading) return <div className="p-4">Загрузка игроков...</div>;

  return (
    <main className="max-w-xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Результат игры</h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block font-semibold mb-2" htmlFor="gameName">
            Название игры:
          </label>
          <input
            id="gameName"
            type="text"
            value={gameName}
            onChange={e => setGameName(e.target.value)}
            className="border rounded px-2 py-1 w-full"
            required
          />
        </div>
        <div>
          <h2 className="font-semibold mb-2">Выберите участников:</h2>
          <div className="grid grid-cols-1 gap-2">
            {players.map((player) => (
              <label key={player.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  value={player.id}
                  checked={participants.some((p) => p.id === player.id)}
                  onChange={(e) =>
                    handleSelect(player.id, e.target.checked)
                  }
                  className="accent-blue-500"
                />
                <span>{player.id} <span className="text-gray-500">({player.elo})</span></span>
              </label>
            ))}
          </div>
        </div>
        {participants.length > 0 && (
          <div>
            <h2 className="font-semibold mb-2">Укажите очки для каждого:</h2>
            <div className="grid grid-cols-1 gap-2">
              {participants.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="w-32">{p.id}</span>
                  <input
                    type="number"
                    step={1}
                    value={p.points}
                    onChange={(e) =>
                      handlePointsChange(p.id, parseFloat(e.target.value) || 0)
                    }
                    className="border rounded px-2 py-1 w-20"
                    required
                  />
                  <span>очков</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          disabled={participants.length === 0 || !gameName.trim()}
        >
          Сохранить результат
        </button>
        {success && (
          <div className="text-green-600 font-semibold mt-2">
            Сохранение пока не реализовано!
          </div>
        )}
      </form>
    </main>
  );
}