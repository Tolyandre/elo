import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Рейтинг игроков",
  description: "Таблица Elo-рейтинга игроков в настольных играх.",
};

export default function PlayersLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
