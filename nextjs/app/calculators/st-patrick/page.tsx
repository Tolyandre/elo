import type { Metadata } from "next";
import { StPatrickCalculator } from "@/app/game/st-patrick-calculator"
import { PageHeader } from "@/app/pageHeaderContext"

export const metadata: Metadata = {
  title: "Охота на змей",
  description: "Калькулятор очков для игры Охота на змей (St. Patrick).",
};

export default function StPatrickCalculatorPage() {
    return (
        <main className="max-w-sm mx-auto">
            <PageHeader title="Охота на змей" />
            <StPatrickCalculator />
        </main>
    )
}
