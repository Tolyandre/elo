"use client";

import { Button } from "@/components/ui/button";
import { SiGoogle } from "@icons-pack/react-simple-icons";
import { EloWebServiceBaseUrl } from "@/app/api";

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
            <a href={`${EloWebServiceBaseUrl}/auth/login`}>
                <SiGoogle className="mr-2 h-4 w-4" /> {label}
            </a>
        </Button>
    );
}
