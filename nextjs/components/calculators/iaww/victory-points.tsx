"use client";
import { useId } from "react";

/**
 * VictoryPoints — badge styled after the victory point tokens
 * in "It's a Wonderful World": dark oval, open laurel wreath, gold star, gold number.
 *
 * hideValue — render badge decoration only, without the number (for row labels).
 */
export function VictoryPoints({
    value = 0,
    hideValue = false,
}: {
    value?: number;
    hideValue?: boolean;
}) {
    const uid = useId().replace(/:/g, "");

    const CX = 28, CY = 30;
    const WREATH_R = 22;
    const START_DEG = 320;
    const ARC_DEG = 260;
    const NUM_LEAVES = 20;

    const leaves = Array.from({ length: NUM_LEAVES }, (_, i) => {
        const t = i / (NUM_LEAVES - 1);
        const deg = START_DEG + t * ARC_DEG;
        const rad = (deg * Math.PI) / 180;
        const x = CX + WREATH_R * Math.cos(rad);
        const y = CY + WREATH_R * Math.sin(rad);
        const tilt = i % 2 === 0 ? 40 : -40;
        return { x, y, rot: deg + tilt };
    });

    const starX = CX;
    const starY = CY + WREATH_R + 1;
    const starPoints = Array.from({ length: 10 }, (_, i) => {
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        const r = i % 2 === 0 ? 9 : 3.8;
        return `${starX + r * Math.cos(a)},${starY + r * Math.sin(a)}`;
    }).join(" ");

    const tips = [START_DEG, START_DEG + ARC_DEG].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        return { x: CX + WREATH_R * Math.cos(rad), y: CY + WREATH_R * Math.sin(rad), rot: deg };
    });

    const fontSize = value >= 100 ? "15" : value >= 10 ? "20" : "24";

    return (
        <svg
            viewBox="0 0 56 68"
            aria-label={hideValue ? "victory points" : `${value} victory points`}
            style={{ width: "2.2em", height: "2.4em", display: "inline-block", verticalAlign: "middle" }}
        >
            <defs>
                <radialGradient id={`${uid}o`} cx="50%" cy="40%" r="55%">
                    <stop offset="0%" stopColor="#2a1400" />
                    <stop offset="60%" stopColor="#1a0900" />
                    <stop offset="100%" stopColor="#0a0400" />
                </radialGradient>
                <radialGradient id={`${uid}i`} cx="50%" cy="30%" r="65%">
                    <stop offset="0%" stopColor="#3a1f00" />
                    <stop offset="100%" stopColor="#0b0600" />
                </radialGradient>
                <linearGradient id={`${uid}t`} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#ffe07a" />
                    <stop offset="45%" stopColor="#f5c000" />
                    <stop offset="100%" stopColor="#b07000" />
                </linearGradient>
                <filter id={`${uid}s`} x="-30%" y="-30%" width="160%" height="160%">
                    <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#000" floodOpacity="0.8" />
                </filter>
            </defs>

            <ellipse cx={CX} cy={CY} rx="26" ry="28" fill={`url(#${uid}o)`} filter={`url(#${uid}s)`} />

            {leaves.map(({ x, y, rot }, i) => (
                <ellipse key={i} cx={x} cy={y} rx="7.5" ry="2.6"
                    transform={`rotate(${rot}, ${x}, ${y})`}
                    fill={i % 2 === 0 ? "#bf7d08" : "#9e6006"}
                    stroke="#5a3200" strokeWidth="0.35" />
            ))}

            {tips.map(({ x, y, rot }, i) => (
                <ellipse key={i} cx={x} cy={y} rx="4" ry="1.5"
                    transform={`rotate(${rot + 90}, ${x}, ${y})`}
                    fill="#9e6006" stroke="#5a3200" strokeWidth="0.3" />
            ))}

            <ellipse cx={CX} cy={CY} rx="18" ry="20" fill={`url(#${uid}i)`} />

            <polygon points={starPoints} fill="#ffe07a" stroke="#8a5500" strokeWidth="0.7" />

            <ellipse cx={CX} cy={CY - 7} rx="9" ry="4" fill="none" stroke="#ffffff" strokeWidth="0.7" opacity="0.07" />

            {!hideValue && (
                <text x={CX} y={CY + 8} textAnchor="middle"
                    fontSize={fontSize} fontWeight="900" fontFamily="Georgia, serif"
                    fill={`url(#${uid}t)`} filter={`url(#${uid}s)`} letterSpacing="-0.5">
                    {value}
                </text>
            )}
        </svg>
    );
}
