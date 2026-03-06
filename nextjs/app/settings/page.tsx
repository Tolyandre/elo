"use client"

import { useMe } from "@/app/meContext"
import { ModeToggle } from "@/components/mode-toggle"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

export default function SettingsPage() {
    const { roundToInteger, setRoundToInteger } = useMe()

    return (
        <main>
            <h1 className="text-2xl font-semibold mb-6">Мои настройки</h1>

            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <Label>Тема оформления</Label>
                    <ModeToggle />
                </div>

                <div className="flex items-center justify-between">
                    <Label htmlFor="round-to-integer">Округлять до целого</Label>
                    <Switch
                        id="round-to-integer"
                        checked={roundToInteger}
                        onCheckedChange={setRoundToInteger}
                    />
                </div>
            </div>
        </main>
    )
}
