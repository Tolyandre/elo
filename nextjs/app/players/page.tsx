"use client";

import React, { useEffect, useState } from "react";

type Player = {
  id: string;
  elo: number;
};

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("https://toly.is-cool.dev/elo-web-service/players")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch players");
        return res.json();
      })
      .then((data) => {
        setPlayers(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <main>
      <h1>Players and Elo Ratings</h1>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Elo</th>
          </tr>
        </thead>
        <tbody>
          {players.map((player) => (
            <tr key={player.id}>
              <td>{player.id}</td>
              <td>{player.elo}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}