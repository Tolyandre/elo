import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Справка",
  description: "Как работает Elo-рейтинг для настольных игр: формулы, примеры и советы.",
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
