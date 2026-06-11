"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getPingPromise } from "@/app/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Terminal } from "lucide-react";

export function PingError() {

    const [pingError, setPingError] = useState<null | true | false>(null);
    const [longWait, setLongWait] = useState(false);
    const pathname = usePathname();

    useEffect(() => {
        let cancelled = false;

        // Reset to the loading state for the freshly navigated route before re-pinging.
        /* eslint-disable react-hooks/set-state-in-effect -- reset ping status on navigation */
        setPingError(null);
        setLongWait(false);
        /* eslint-enable react-hooks/set-state-in-effect */
        const timer = setTimeout(() => {
            if (!cancelled) setLongWait(true);
        }, 5000);

        getPingPromise()
            .then(() => { if (!cancelled) setPingError(false); })
            .catch(() => { if (!cancelled) setPingError(true); });

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [pathname]);

    // Derived during render — no separate state/effect needed.
    const showAlert = (longWait && pingError === null) || pingError === true;

    if (showAlert)
        return (
            <Alert variant="default" className="max-w-100">
                <Terminal />
                <AlertTitle>Сервер недоступен</AlertTitle>
                <AlertDescription>
                    Сервер хостится на ПК и бывает выключен
                </AlertDescription>
            </Alert>)

    return null;
}