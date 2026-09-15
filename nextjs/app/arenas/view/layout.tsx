import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Арена",
  description: "Рейтинг, партии и медали арены.",
};

export default function ArenaViewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
