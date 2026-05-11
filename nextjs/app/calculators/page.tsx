import Link from "next/link"
import { Skull, Crosshair, Globe, Activity } from "lucide-react"

const items = [
  {
    href: "/calculators/skull-king",
    icon: <Skull className="h-6 w-6" />,
    title: "Skull King",
  },
  {
    href: "/calculators/skull-king-game",
    icon: <Skull className="h-6 w-6" />,
    title: "Skull King: игра",
  },
  {
    href: "/calculators/st-patrick",
    icon: <Crosshair className="h-6 w-6" />,
    title: "Охота на змей",
  },
  {
    href: "/calculators/elo-reset",
    icon: <Activity className="h-6 w-6" />,
    title: "Сходимость Эло",
  },
  {
    href: "/its-a-wonderful-world",
    icon: <Globe className="h-6 w-6" />,
    title: "Этот Безумный Мир",
  },
] as const

export default function CalculatorsPage() {
  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex items-center gap-3 py-3 hover:text-foreground/80 transition-colors"
            >
              {item.icon}
              <span className="text-sm font-medium">{item.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
