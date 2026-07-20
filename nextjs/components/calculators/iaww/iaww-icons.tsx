"use client";
import { useId } from "react";

/** Shared wrapper: square with rounded corners and solid background */
function IconFrame({
    bg,
    children,
    size = "2.4em",
}: {
    bg: string;
    children: React.ReactNode;
    size?: string;
}) {
    return (
        <svg
            viewBox="0 0 48 48"
            style={{ width: size, height: size, display: "inline-block", verticalAlign: "middle" }}
        >
            <rect x="1" y="1" width="46" height="46" rx="7" ry="7" fill={bg} />
            {children}
        </svg>
    );
}

/** 1. Structure — factory with smokestacks */
export function StructureIcon({ size }: { size?: string }) {
    return (
        <IconFrame bg="#3a3a3a" size={size}>
            {/* Smokestacks */}
            <rect x="10" y="14" width="7" height="18" rx="1" fill="#8a8a8a" />
            <rect x="20" y="10" width="7" height="22" rx="1" fill="#9a9a9a" />
            <rect x="30" y="17" width="7" height="15" rx="1" fill="#7a7a7a" />
            {/* Factory body */}
            <rect x="7" y="32" width="34" height="11" rx="1" fill="#b0b0b0" />
            {/* Windows */}
            <rect x="11" y="34" width="5" height="5" rx="1" fill="#3a3a3a" />
            <rect x="21" y="34" width="5" height="5" rx="1" fill="#3a3a3a" />
            <rect x="31" y="34" width="5" height="5" rx="1" fill="#3a3a3a" />
            {/* Smoke puffs */}
            <circle cx="13" cy="11" r="3" fill="#666" opacity="0.7" />
            <circle cx="16" cy="9" r="2.5" fill="#555" opacity="0.6" />
            <circle cx="23" cy="7" r="3" fill="#666" opacity="0.7" />
            <circle cx="26" cy="5" r="2.5" fill="#555" opacity="0.6" />
        </IconFrame>
    );
}

/** 2. Vehicle — tank */
export function VehicleIcon({ size }: { size?: string }) {
    return (
        <IconFrame bg="#111111" size={size}>
            {/* Treads */}
            <rect x="7" y="31" width="34" height="9" rx="4" fill="#333333" />
            {/* Tread detail */}
            {[10, 15, 20, 25, 30, 35].map((x) => (
                <rect key={x} x={x} y="31" width="3" height="9" rx="1" fill="#1a1a1a" opacity="0.8" />
            ))}
            {/* Hull */}
            <rect x="9" y="26" width="30" height="9" rx="2" fill="#444444" />
            {/* Turret */}
            <rect x="15" y="18" width="18" height="11" rx="3" fill="#555555" />
            {/* Barrel */}
            <rect x="30" y="21" width="14" height="4" rx="2" fill="#444444" />
            {/* Hatch circle */}
            <circle cx="22" cy="21" r="3.5" fill="#333333" />
            <circle cx="22" cy="21" r="2" fill="#1a1a1a" />
        </IconFrame>
    );
}

/** 3. Project — classical building with columns */
export function ProjectIcon({ size }: { size?: string }) {
    const uid = useId().replace(/:/g, "");
    return (
        <IconFrame bg="#8a6400" size={size}>
            <defs>
                <linearGradient id={`${uid}col`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#e8c060" />
                    <stop offset="40%" stopColor="#f5d878" />
                    <stop offset="100%" stopColor="#c8980a" />
                </linearGradient>
            </defs>
            {/* Pediment (triangle top) */}
            <polygon points="7,20 24,8 41,20" fill={`url(#${uid}col)`} />
            <polygon points="9,20 24,10 39,20" fill="none" stroke="#c8980a" strokeWidth="0.5" />
            {/* Entablature (beam under pediment) */}
            <rect x="7" y="19" width="34" height="4" fill={`url(#${uid}col)`} />
            {/* Columns */}
            {[11, 18, 25, 32].map((x) => (
                <rect key={x} x={x} y="23" width="5" height="14" rx="1" fill={`url(#${uid}col)`} />
            ))}
            {/* Steps */}
            <rect x="7" y="37" width="34" height="3" rx="1" fill={`url(#${uid}col)`} />
            <rect x="5" y="40" width="38" height="3" rx="1" fill={`url(#${uid}col)`} />
        </IconFrame>
    );
}

/** 4. Discovery — isometric open treasure chest (mirrored: bright face right, lid upper-left)
 *  Vectors (screen): L=(-12,+6) left-fwd, R=(+12,+6) right-fwd, H=(0,-14) up
 *  Key corners: BFR(35,36) BFL(23,42) BBL(11,36)
 *               TFR(35,22) TFL(23,28) TBL(11,22) TBR(23,16)
 *  Lid hinge TBR–TBL; opens upper-left: LFR(27,8) LFL(15,14)
 *  Lid top edge is curved (rounded chest arc).
 */
export function DiscoveryIcon({ size }: { size?: string }) {
    return (
        <IconFrame bg="#0d3d5c" size={size}>
            {/* 1. Lid outer face — curved top edge (furthest from viewer) */}
            <path d="M 23,16 L 11,22 L 15,14 Q 21,6 27,8 Z" fill="#50bce0" />
            {/* Lid curved top-edge highlight */}
            <path d="M 15,14 Q 21,6 27,8" fill="none" stroke="#90e0ff" strokeWidth="1.8" strokeLinecap="round" />

            {/* 2. Open interior — dark void visible from above */}
            <polygon points="35,22 23,28 11,22 23,16" fill="#071828" />

            {/* 3. Left/side face (darker) */}
            <polygon points="23,42 11,36 11,22 23,28" fill="#186088" />

            {/* 4. Right/front face — main bright face */}
            <polygon points="35,36 23,42 23,28 35,22" fill="#3090c0" />

            {/* Metal band across front face */}
            <polygon points="35,30 23,36 23,39 35,33" fill="#145070" />

            {/* Clasp — gold with dark keyhole */}
            <polygon points="32,31 27,33 27,38 32,36" fill="#c89810" />
            <polygon points="31,32 28,34 28,37 31,35" fill="#7a5e08" />

            {/* Front face top-rim highlight */}
            <line x1="35" y1="22" x2="23" y2="28" stroke="#58c0e8" strokeWidth="1.5" />
            {/* Side face top-rim */}
            <line x1="23" y1="28" x2="11" y2="22" stroke="#3080a8" strokeWidth="1" />
            {/* Lid hinge edge */}
            <line x1="23" y1="16" x2="11" y2="22" stroke="#2870b0" strokeWidth="1" />
        </IconFrame>
    );
}

/** 5. Research — atom: nucleus + 3 orbital ellipses */
export function ResearchIcon({ size }: { size?: string }) {
    return (
        <IconFrame bg="#1c4a0a" size={size}>
            {/* Orbital ellipses */}
            <ellipse cx="24" cy="24" rx="20" ry="7" fill="none" stroke="#7cda3c" strokeWidth="2.5" />
            <ellipse cx="24" cy="24" rx="20" ry="7" fill="none" stroke="#7cda3c" strokeWidth="2.5"
                transform="rotate(60 24 24)" />
            <ellipse cx="24" cy="24" rx="20" ry="7" fill="none" stroke="#7cda3c" strokeWidth="2.5"
                transform="rotate(120 24 24)" />
            {/* Nucleus */}
            <circle cx="24" cy="24" r="4.5" fill="#7cda3c" />
            <circle cx="24" cy="24" r="2.5" fill="#1c4a0a" />
        </IconFrame>
    );
}

/** Round token frame (for general and financier) */
function TokenFrame({
    rimColor,
    rimColor2,
    bg,
    size = "2.6em",
    children,
}: {
    rimColor: string;
    rimColor2: string;
    bg: string;
    size?: string;
    children: React.ReactNode;
}) {
    const uid = useId().replace(/:/g, "");
    return (
        <svg
            viewBox="0 0 52 52"
            style={{ width: size, height: size, display: "inline-block", verticalAlign: "middle" }}
        >
            <defs>
                <radialGradient id={`${uid}rim`} cx="35%" cy="30%" r="70%">
                    <stop offset="0%" stopColor={rimColor} />
                    <stop offset="100%" stopColor={rimColor2} />
                </radialGradient>
            </defs>
            {/* Outer rim */}
            <circle cx="26" cy="26" r="25" fill={`url(#${uid}rim)`} />
            {/* Inner portrait area */}
            <circle cx="26" cy="26" r="21" fill={bg} />
            {children}
        </svg>
    );
}

/** 6. General token */
export function GeneralToken({ size }: { size?: string }) {
    return (
        <TokenFrame rimColor="#c8a060" rimColor2="#7a5820" bg="#3a2a1a" size={size}>
            {/* Simplified soldier silhouette */}
            {/* Military cap */}
            <rect x="18" y="12" width="16" height="5" rx="2" fill="#7a9060" />
            <rect x="16" y="16" width="20" height="3" rx="1" fill="#6a8050" />
            {/* Head */}
            <ellipse cx="26" cy="24" rx="7" ry="8" fill="#d4a878" />
            {/* Eyes */}
            <ellipse cx="23" cy="23" rx="1.5" ry="1.5" fill="#3a2a1a" />
            <ellipse cx="29" cy="23" rx="1.5" ry="1.5" fill="#3a2a1a" />
            {/* Collar / uniform */}
            <path d="M19 32 Q19 38 26 40 Q33 38 33 32 L30 30 Q26 34 22 30 Z" fill="#5a6840" />
            {/* Stars on collar */}
            <polygon points="22,31 23,29 24,31 22.5,30 23.5,30" fill="#d4a010" />
            <polygon points="28,31 29,29 30,31 28.5,30 29.5,30" fill="#d4a010" />
        </TokenFrame>
    );
}

/** 7. Culture token */
export function CultureToken({ size }: { size?: string }) {
    return (
        <TokenFrame rimColor="#c8a060" rimColor2="#7a5000" bg="#5a2a4a" size={size}>
            {/* Curly hair — wide mass around the head */}
            <ellipse cx="26" cy="18" rx="11" ry="9" fill="#1a0d04" />
            {/* Curly side locks */}
            <ellipse cx="15" cy="24" rx="4" ry="7" fill="#1a0d04" />
            <ellipse cx="37" cy="24" rx="4" ry="7" fill="#1a0d04" />
            {/* Curl bumps on top */}
            <ellipse cx="20" cy="13" rx="3.5" ry="3" fill="#241005" />
            <ellipse cx="26" cy="11" rx="3.5" ry="3" fill="#241005" />
            <ellipse cx="32" cy="13" rx="3.5" ry="3" fill="#241005" />
            {/* Face */}
            <ellipse cx="26" cy="25" rx="7" ry="8" fill="#d4a070" />
            {/* Eyes */}
            <ellipse cx="23" cy="24" rx="1.3" ry="1.5" fill="#2a1a08" />
            <ellipse cx="29" cy="24" rx="1.3" ry="1.5" fill="#2a1a08" />
            {/* Lips */}
            <path d="M23 29.5 Q26 31.5 29 29.5" fill="none" stroke="#b06050" strokeWidth="1.2" strokeLinecap="round" />
            {/* Clothing — warm amber/yellow neckline */}
            <path d="M19 33 Q19 40 26 42 Q33 40 33 33 L30 31 Q26 35 22 31 Z" fill="#c87a10" />
        </TokenFrame>
    );
}

/** 8. Financier token */
export function FinancierToken({ size }: { size?: string }) {
    return (
        <TokenFrame rimColor="#888888" rimColor2="#444444" bg="#2a2a3a" size={size}>
            {/* Simplified businessman silhouette */}
            {/* Hair */}
            <ellipse cx="26" cy="17" rx="8" ry="6" fill="#2a1a0a" />
            {/* Head */}
            <ellipse cx="26" cy="24" rx="7" ry="8" fill="#c8a070" />
            {/* Glasses */}
            <circle cx="23" cy="23" r="2.5" fill="none" stroke="#888" strokeWidth="1" />
            <circle cx="29" cy="23" r="2.5" fill="none" stroke="#888" strokeWidth="1" />
            <line x1="25.5" y1="23" x2="26.5" y2="23" stroke="#888" strokeWidth="1" />
            {/* Suit lapels */}
            <path d="M19 32 L22 29 L26 34 L30 29 L33 32 Q33 40 26 41 Q19 40 19 32 Z" fill="#2a3a6a" />
            {/* Tie */}
            <path d="M24 30 L26 29 L28 30 L27 38 L26 39 L25 38 Z" fill="#cc2020" />
        </TokenFrame>
    );
}
