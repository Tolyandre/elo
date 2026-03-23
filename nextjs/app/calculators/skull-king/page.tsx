import type { Metadata } from "next";
import { SkullKingCalculator } from "@/app/game/skull-king-calculator"

export const metadata: Metadata = {
  title: "Skull King",
  description: "Калькулятор очков для карточной игры Skull King.",
};

export default function SkullKingCalculatorPage() {
    return (
        <main className="max-w-sm mx-auto">
            <h1 className="text-2xl font-semibold mb-6">Skull King</h1>
            <SkullKingCalculator />
        </main>
    )
}
