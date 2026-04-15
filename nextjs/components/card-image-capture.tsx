"use client";

// This component must only be rendered on the client (no SSR).
// Import it with: dynamic(() => import("@/components/card-image-capture"), { ssr: false })

import { useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseSkullKingCardImagePromise, SkullKingCardImageResult } from "@/app/api";

export type CardImageCaptureProps = {
    onResult: (card: SkullKingCardImageResult) => void;
};

type Status = "idle" | "processing" | "error";

export function CardImageCapture({ onResult }: CardImageCaptureProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [status, setStatus] = useState<Status>("idle");
    const [errorMessage, setErrorMessage] = useState("");
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Show preview
        const objectUrl = URL.createObjectURL(file);
        setPreviewUrl(objectUrl);
        setStatus("processing");
        setErrorMessage("");

        try {
            // Convert to base64 (strip data-URI prefix — Ollama expects raw base64)
            const base64 = await fileToBase64(file);
            const result = await parseSkullKingCardImagePromise(base64);
            onResult(result);
            setStatus("idle");
        } catch (err) {
            setStatus("error");
            setErrorMessage(err instanceof Error ? err.message : "Не удалось распознать карту");
        } finally {
            // Reset input so the same file can be selected again
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    const clear = () => {
        setStatus("idle");
        setErrorMessage("");
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
        }
        if (inputRef.current) inputRef.current.value = "";
    };

    return (
        <div className="flex items-center gap-2">
            {/* Hidden file input — capture="environment" opens the rear camera on mobile */}
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
            />

            <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={status === "processing"}
                onClick={() => inputRef.current?.click()}
                aria-label="Сфотографировать карту"
            >
                {status === "processing" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                    <Camera className="h-4 w-4" />
                )}
            </Button>

            <span className="text-sm text-muted-foreground">
                {status === "idle" && "Сфотографировать карту"}
                {status === "processing" && "Распознаю..."}
                {status === "error" && (
                    <span className="text-destructive">{errorMessage}</span>
                )}
            </span>

            {(previewUrl || status === "error") && (
                <button
                    type="button"
                    onClick={clear}
                    aria-label="Сбросить"
                    className="text-muted-foreground hover:text-foreground"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    );
}

function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result as string;
            // Strip "data:<mime>;base64," prefix — Ollama wants raw base64
            const base64 = dataUrl.split(",")[1];
            resolve(base64);
        };
        reader.onerror = () => reject(new Error("Ошибка чтения файла"));
        reader.readAsDataURL(file);
    });
}
