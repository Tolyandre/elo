'use client';

import React, { Suspense } from 'react';
import Oauth2CallbackClient from './oauth2-callback.client';

// Wrap the client component in Suspense to satisfy Next.js requirements
export default function Oauth2CallbackPage() {
    return (
        <Suspense>
            <Oauth2CallbackClient />
        </Suspense>
    );
}
