"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getPingPromise } from "@/app/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Terminal } from "lucide-react";

export function PingError() {

    const [pingError, setPingError] = useState<null | true | false>(null);
    const [longWait, setLongWait] = useState(false);
    const [showAlert, setShowAlert] = useState(false);
    const pathname = usePathname();

    useEffect(() => {
        let cancelled = false;

        setPingError(null);
        setLongWait(false);
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

    useEffect(() => {
        setShowAlert(longWait && pingError === null || pingError === true);
    }, [longWait, pingError]);

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