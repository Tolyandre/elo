import type { Metadata } from "next";
import { StPatrickCalculator } from "@/app/game/st-patrick-calculator"

export const metadata: Metadata = {
  title: "Охота на змей",
  description: "Калькулятор очков для игры Охота на змей (St. Patrick).",
};

export default function StPatrickCalculatorPage() {
    return (
        <main className="max-w-sm mx-auto">
            <h1 className="text-2xl font-semibold mb-6">Охота на змей</h1>
            <StPatrickCalculator />
        </main>
    )
}
