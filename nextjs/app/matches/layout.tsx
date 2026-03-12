import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Партии",
  description: "История сыгранных партий с фильтрацией по игроку и игре.",
};

export default function MatchesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
