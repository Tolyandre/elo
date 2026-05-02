"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Redirect() {
    const router = useRouter();
    useEffect(() => { router.replace("/calculators/skull-king-game"); }, [router]);
    return null;
}
