"use client"
import { getGamesPromise } from "@/app/api";
import Link from "next/link";
import React from "react";
import { Gamepad2 } from "lucide-react";
import { PageHeader } from "@/app/pageHeaderContext";
import { PageContainer } from "@/components/page-container";
import { EmptyState } from "@/components/empty-state";
import { ResponsiveTable } from "@/components/responsive-table";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { Card, CardContent } from "@/components/ui/card";

export default function AllGamesList() {
  const { data: games, loading } = useAsyncResource(getGamesPromise);

  if (loading || !games) {
    return (
      <PageContainer width="narrow">
        <PageHeader title="Игры" />
      </PageContainer>
    );
  }

  return (
    <PageContainer width="narrow">
      <PageHeader title="Игры" />
      {games.games.length === 0 && <EmptyState icon={Gamepad2} title="Игр пока нет" />}
      <ResponsiveTable
        mobile={
          <Card>
            <CardContent className="divide-y">
              {games.games.map((game) => (
                <div key={game.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <Link href={`/games/view?id=${game.id}`} className="font-medium underline min-w-0">
                    {game.name}
                  </Link>
                  <span className="text-sm text-muted-foreground shrink-0 whitespace-nowrap">
                    {game.total_matches}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        }
        desktop={
          <table className="w-full table-auto border-collapse mb-6">
            <tbody>
              {games.games.map((game) => {
                return (
                  <tr key={game.id}>
                    <td className="px-4 py-2">
                      <Link className="underline" href={`/games/view?id=${game.id}`}>{game.name}</Link>
                    </td>
                    <td className="px-4 py-2">{game.total_matches}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        }
      />
    </PageContainer>
  );
}
