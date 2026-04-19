import type { Metadata } from "next";
import { SkullKingCalculator } from "@/app/game/skull-king-calculator"
import { PageHeader } from "@/app/pageHeaderContext"

export const metadata: Metadata = {
  title: "Skull King",
  description: "Калькулятор очков для карточной игры Skull King.",
};

export default function SkullKingCalculatorPage() {
    return (
        <main className="max-w-sm mx-auto">
            <PageHeader title="Skull King" />
            <SkullKingCalculator />
        </main>
    )
}
