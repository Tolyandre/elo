import type { Metadata } from "next";
import { StPatrickCalculator } from "@/app/games/st-patrick-calculator"
import { PageHeader } from "@/app/pageHeaderContext"
import { PageContainer } from "@/components/page-container"

export const metadata: Metadata = {
  title: "Охота на змей",
  description: "Калькулятор очков для игры Охота на змей (St. Patrick).",
};

export default function StPatrickCalculatorPage() {
    return (
        <PageContainer width="narrow">
            <PageHeader title="Охота на змей" />
            <StPatrickCalculator />
        </PageContainer>
    )
}
