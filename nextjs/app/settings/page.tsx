"use client"

import { useMe } from "@/app/meContext"
import { ModeToggle } from "@/components/mode-toggle"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { PlayerCombobox } from "@/components/player-combobox"
import { patchMePromise } from "@/app/api"

export default function SettingsPage() {
    const { roundToInteger, setRoundToInteger, isAuthenticated, playerId, invalidate } = useMe()

    async function handlePlayerChange(id?: string) {
        try {
            await patchMePromise({ player_id: id ?? null })
            invalidate()
        } catch {
            // toast shown by API helper
        }
    }

    return (
        <main className="max-w-sm mx-auto">
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

                {isAuthenticated ? (
                    <div className="flex flex-col gap-2">
                        <Label>Мой игрок</Label>
                        <PlayerCombobox value={playerId} onChange={handlePlayerChange} allowClear />
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">После входа будут доступны дополнительные настройки.</p>
                )}
            </div>
        </main>
    )
}
