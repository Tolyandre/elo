"use client";

import { useState, useRef } from "react";
import { Mic, MicOff, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseVoiceInput, VoiceParseResult } from "@/app/api";

export type VoiceInputProps = {
    onResult: (gameId: string | undefined, scores: { playerId: string; points: number }[]) => void;
};

// Minimal Web Speech API types — not yet universally shipped in @types/dom
interface ISpeechRecognitionResultItem {
    readonly transcript: string;
    readonly confidence: number;
}

interface ISpeechRecognitionResult {
    readonly isFinal: boolean;
    readonly length: number;
    item(index: number): ISpeechRecognitionResultItem;
    [index: number]: ISpeechRecognitionResultItem;
}

interface ISpeechRecognitionResultList {
    readonly length: number;
    item(index: number): ISpeechRecognitionResult;
    [index: number]: ISpeechRecognitionResult;
}

interface ISpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: ISpeechRecognitionResultList;
}

interface ISpeechRecognitionErrorEvent extends Event {
    readonly error: string;
    readonly message: string;
}

interface ISpeechRecognition extends EventTarget {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    onresult: ((event: ISpeechRecognitionEvent) => void) | null;
    onerror: ((event: ISpeechRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
}

declare global {
    interface Window {
        SpeechRecognition?: new () => ISpeechRecognition;
        webkitSpeechRecognition?: new () => ISpeechRecognition;
    }
}

type Status = "idle" | "recording" | "processing" | "error";
type Lang = "ru-RU" | "en-US";

export function VoiceInput({ onResult }: VoiceInputProps) {
    const [transcripts, setTranscripts] = useState<string[]>([]);
    const [status, setStatus] = useState<Status>("idle");
    const [interimText, setInterimText] = useState("");
    const [errorMessage, setErrorMessage] = useState("");
    const [lang, setLang] = useState<Lang>("ru-RU");
    const recognitionRef = useRef<ISpeechRecognition | null>(null);

    const isSupported =
        typeof window !== "undefined" &&
        !!(window.SpeechRecognition || window.webkitSpeechRecognition);

    const startRecording = () => {
        const SpeechRecognitionCtor =
            window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognitionCtor) return;

        const recognition: ISpeechRecognition = new SpeechRecognitionCtor();
        // Chrome's ru-RU recognizer handles English proper nouns (game names) well.
        // Switch to en-US via the toggle if pure English input is needed.
        recognition.lang = lang;
        recognition.interimResults = true;
        recognition.continuous = false;
        recognitionRef.current = recognition;

        recognition.onresult = (event: ISpeechRecognitionEvent) => {
            let interim = "";
            let final = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const text = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    final += text;
                } else {
                    interim += text;
                }
            }
            setInterimText(interim);
            if (final) {
                setInterimText("");
                processTranscript(final);
            }
        };

        recognition.onerror = (event: ISpeechRecognitionErrorEvent) => {
            setStatus("error");
            setErrorMessage(`Ошибка распознавания: ${event.error}`);
            recognitionRef.current = null;
        };

        recognition.onend = () => {
            setInterimText("");
            recognitionRef.current = null;
            setStatus((prev) => (prev === "recording" ? "idle" : prev));
        };

        recognition.start();
        setStatus("recording");
        setErrorMessage("");
    };

    const stopRecording = () => {
        recognitionRef.current?.stop();
    };

    const processTranscript = async (newText: string) => {
        setStatus("processing");
        const allTranscripts = [...transcripts, newText];
        setTranscripts(allTranscripts);

        try {
            const combined = allTranscripts.join(". ");
            const result: VoiceParseResult = await parseVoiceInput(combined);
            onResult(
                result.game_id ?? undefined,
                result.scores.map((s) => ({ playerId: s.player_id, points: s.points }))
            );
            setStatus("idle");
        } catch {
            setStatus("error");
            setErrorMessage("Не удалось распознать. Попробуйте ещё раз.");
        }
    };

    const handleMicClick = () => {
        if (status === "recording") {
            stopRecording();
        } else if (status === "idle" || status === "error") {
            startRecording();
        }
    };

    const clearAll = () => {
        recognitionRef.current?.stop();
        setTranscripts([]);
        setStatus("idle");
        setInterimText("");
        setErrorMessage("");
        // Notify parent to reset form state
        onResult(undefined, []);
    };

    const toggleLang = () => {
        setLang((prev) => (prev === "ru-RU" ? "en-US" : "ru-RU"));
    };

    if (!isSupported) {
        return (
            <p className="text-sm text-gray-400">
                Голосовой ввод не поддерживается в этом браузере (нужен Chrome или Edge)
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <Button
                    type="button"
                    variant={status === "recording" ? "destructive" : "outline"}
                    size="icon"
                    onClick={handleMicClick}
                    disabled={status === "processing"}
                    aria-label={status === "recording" ? "Остановить запись" : "Начать голосовой ввод"}
                    className={status === "recording" ? "animate-pulse" : ""}
                >
                    {status === "processing" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : status === "recording" ? (
                        <MicOff className="h-4 w-4" />
                    ) : (
                        <Mic className="h-4 w-4" />
                    )}
                </Button>

                {/* Language toggle: ru-RU handles Cyrillic + embedded English proper nouns.
                    Switch to en-US when speaking pure English game names. */}
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={toggleLang}
                    disabled={status === "recording" || status === "processing"}
                    className="text-xs px-2 text-gray-500"
                    aria-label="Переключить язык распознавания"
                >
                    {lang === "ru-RU" ? "RU" : "EN"}
                </Button>

                <span className="text-sm text-gray-500">
                    {status === "idle" && transcripts.length === 0 && "Нажмите для голосового ввода"}
                    {status === "idle" && transcripts.length > 0 && "Нажмите ещё раз для уточнения"}
                    {status === "recording" && "Говорите..."}
                    {status === "processing" && "Распознаю..."}
                    {status === "error" && errorMessage}
                </span>

            </div>

            {/* Accumulated transcripts + live interim preview */}
            {(transcripts.length > 0 || interimText) && (
                <div className="relative text-sm text-gray-600 bg-gray-50 rounded px-3 py-2 pr-8">
                    {transcripts.map((t, i) => (
                        <span key={i}>{t}{i < transcripts.length - 1 ? ". " : ""}</span>
                    ))}
                    {interimText && (
                        <span className="text-gray-400"> {interimText}</span>
                    )}
                    {transcripts.length > 0 && (
                        <button
                            type="button"
                            onClick={clearAll}
                            aria-label="Очистить"
                            className="absolute top-1.5 right-1.5 text-gray-400 hover:text-gray-600"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
