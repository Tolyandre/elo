"use client";

import { useTenants } from "@/app/tenantsContext";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";

/**
 * The "tenant list did not load" surface (ADR-36): offline with a cold cache
 * or an API blip. Deliberately distinct from «Сообщество не найдено» — the
 * current community may well exist, its list just never arrived, so the
 * pages must offer a retry instead of declaring it deleted.
 */
export function TenantsLoadError() {
    const { error, invalidate } = useTenants();
    if (!error) return null;
    return (
        <div className="space-y-3">
            <ErrorAlert message="Не удалось загрузить список сообществ." />
            <Button variant="outline" size="sm" onClick={invalidate}>
                Повторить
            </Button>
        </div>
    );
}
