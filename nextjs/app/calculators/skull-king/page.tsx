import type { Metadata } from "next";
import { SkullKingCalculator } from "@/app/games/skull-king-calculator"
import { PageHeader } from "@/app/pageHeaderContext"
import { PageContainer } from "@/components/page-container"

export const metadata: Metadata = {
  title: "Skull King",
  description: "Калькулятор очков для карточной игры Skull King.",
};

export default function SkullKingCalculatorPage() {
    return (
        <PageContainer width="narrow">
            <PageHeader title="Skull King" />
            <SkullKingCalculator />
        </PageContainer>
    )
}
