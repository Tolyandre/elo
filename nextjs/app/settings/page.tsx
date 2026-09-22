"use client"
import type { Base58ID } from "@/lib/id";

import { useMe } from "@/app/meContext"
import { PageHeader } from "@/app/pageHeaderContext"
import { ModeToggle } from "@/components/mode-toggle"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { PlayerCombobox } from "@/components/player-combobox"
import { patchMePromise } from "@/app/api"
import { LoginLink } from "@/components/login-link"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useUrlQuery, setUrlQuery } from "@/lib/url-state"

export default function SettingsPage() {
    const { roundToInteger, setRoundToInteger, geologistMode, setGeologistMode, isAuthenticated, playerId, invalidate } = useMe()
    const params = useUrlQuery();
    const suggestLinkPlayer = isAuthenticated && params.get("link-player") === "1"

    async function handlePlayerChange(id?: Base58ID) {
        try {
            await patchMePromise({ player_id: id ?? null })
            invalidate()
        } catch {
            // toast shown by API helper
        }
    }

    return (
        <main className="max-w-sm mx-auto">
            <PageHeader title="Мои настройки" />

            <div className="space-y-6">
                {suggestLinkPlayer && (
                    <Alert>
                        <AlertCircleIcon />
                        <AlertTitle>Осталось привязать игрока</AlertTitle>
                        <AlertDescription className="flex flex-col items-start gap-2">
                            <span>
                                Выберите своего игрока ниже — он понадобится для записи на турниры и ставок.
                            </span>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setUrlQuery((params) => params.delete("link-player"))}
                            >
                                Понятно
                            </Button>
                        </AlertDescription>
                    </Alert>
                )}

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

                <div className="flex items-center justify-between">
                    <Label htmlFor="geologist-mode">Режим Геолога</Label>
                    <Switch
                        id="geologist-mode"
                        checked={geologistMode}
                        onCheckedChange={setGeologistMode}
                    />
                </div>

                {isAuthenticated ? (
                    <div className="flex flex-col gap-2">
                        <Label>Мой игрок</Label>
                        <PlayerCombobox value={playerId} onChange={handlePlayerChange} allowClear />
                    </div>
                ) : (
                    <div className="flex flex-col items-start gap-2">
                        <p className="text-sm text-muted-foreground">После входа будут доступны дополнительные настройки.</p>
                        <LoginLink />
                    </div>
                )}
            </div>
        </main>
    )
}
