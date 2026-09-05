import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shared "back to the list" control so every view/admin page offers the same
 * outline button with an arrow instead of ad-hoc text links.
 */
export function BackButton({ href, label = "Назад" }: { href: string; label?: string }) {
    return (
        <div className="mb-4">
            <Button asChild variant="outline">
                <Link href={href}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    {label}
                </Link>
            </Button>
        </div>
    );
}
