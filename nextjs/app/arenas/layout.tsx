import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Арены",
  description: "Список арен: независимые рейтинги по избранным партиям.",
};

export default function ArenasLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
