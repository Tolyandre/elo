import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

// Standard error banner used across pages so failures look the same everywhere.
export function ErrorAlert({ message, className }: { message: string; className?: string }) {
    return (
        <Alert variant="destructive" className={className}>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Ошибка: {message}</AlertDescription>
        </Alert>
    );
}
