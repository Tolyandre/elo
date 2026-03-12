import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Игры",
  description: "Список настольных игр с количеством сыгранных партий.",
};

export default function GamesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
