"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getPingPromise } from "./api";

export function PingError() {

    const [pingError, setPingError] = useState(false);

    // Re-run the ping whenever the pathname changes (client-side navigation)
    const pathname = usePathname();

    useEffect(() => {
        getPingPromise()
            .then(() => setPingError(false))
            .catch(() => setPingError(true));
    }, [pathname]);

    if (pingError)
        return <div>Сервер хостится на ПК и бывает выключен. Попробуйте утром</div>;

    return null;
}