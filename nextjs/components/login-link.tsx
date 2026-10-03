"use client";

import { Button } from "@/components/ui/button";
import { SiGoogle } from "@icons-pack/react-simple-icons";
import { EloWebServiceBaseUrl } from "@/app/api";
import { loginUrl } from "@/lib/login-url";
import { redirectTo } from "@/lib/redirect";

/**
 * A button-styled link that starts the Google OAuth2 login flow.
 * Reused across "login required" messages so each one offers a way to log in.
 */
export function LoginLink({
    label = "Войти",
    size = "sm",
    variant = "outline",
}: {
    label?: string;
    size?: "sm" | "default" | "lg";
    variant?: "outline" | "default" | "secondary" | "ghost";
}) {
    return (
        <Button asChild size={size} variant={variant}>
            {/* Static href keeps the prerendered page working without
                hydration; the click re-navigates with the current mirror in
                "from" so the user is returned here after Google auth. */}
            <a
                href={`${EloWebServiceBaseUrl}/auth/login`}
                onClick={(e) => {
                    e.preventDefault();
                    redirectTo(loginUrl());
                }}
            >
                <SiGoogle className="mr-2 h-4 w-4" /> {label}
            </a>
        </Button>
    );
}
