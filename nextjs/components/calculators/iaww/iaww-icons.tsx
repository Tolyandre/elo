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

/** Portrait-token frame shared by General / Culture / Financier, modelled on
 *  the physical scoring tokens: colored rim, radially lit background and
 *  clipped bust portrait (no value mark — the scoring UI shows it beside). */
function PortraitToken({
    rimLight,
    rimDark,
    bgLight,
    bgDark,
    size = "2.6em",
    children,
}: {
    rimLight: string;
    rimDark: string;
    bgLight: string;
    bgDark: string;
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
                <radialGradient id={`${uid}rim`} cx="35%" cy="30%" r="75%">
                    <stop offset="0%" stopColor={rimLight} />
                    <stop offset="100%" stopColor={rimDark} />
                </radialGradient>
                <radialGradient id={`${uid}bg`} cx="38%" cy="28%" r="90%">
                    <stop offset="0%" stopColor={bgLight} />
                    <stop offset="100%" stopColor={bgDark} />
                </radialGradient>
                <clipPath id={`${uid}art`}>
                    <circle cx="26" cy="26" r="21" />
                </clipPath>
            </defs>
            {/* Rim + portrait background */}
            <circle cx="26" cy="26" r="25" fill={`url(#${uid}rim)`} />
            <circle cx="26" cy="26" r="21" fill={`url(#${uid}bg)`} />
            {/* Bust, cropped by the inner disc */}
            <g clipPath={`url(#${uid}art)`}>{children}</g>
        </svg>
    );
}

/** Neck + shoulders. Identical geometry on every token so the three
 *  portraits read as one family (head at 26,22 r 8.8/10; eye line y 21.6). */
function Bust({ clothing }: { clothing: string }) {
    return (
        <path
            d="M 10.6 47 C 11.2 38 16 33.6 22 32.9 L 23 31.4 L 29 31.4 L 30 32.9 C 36 33.6 40.8 38 41.4 47 Z"
            fill={clothing}
        />
    );
}

function Eyes({ color }: { color: string }) {
    return (
        <g fill={color}>
            <ellipse cx="22.2" cy="21.6" rx="1.15" ry="1.35" />
            <ellipse cx="29.8" cy="21.6" rx="1.15" ry="1.35" />
        </g>
    );
}

function Nose({ color }: { color: string }) {
    return (
        <path d="M 26 21.8 L 26 24.4 Q 26 25.4 25.1 25.4" fill="none" stroke={color} strokeWidth="0.9" strokeLinecap="round" />
    );
}

/** Handlebar mustache shared by the financier and the general */
function Mustache({ color }: { color: string }) {
    return (
        <path
            d="M 26 25.4 C 24 24.9 22 25.2 21.6 26.9 C 23.4 28.1 25.2 27.5 26 26.5 C 26.8 27.5 28.6 28.1 30.4 26.9 C 30 25.2 28 24.9 26 25.4 Z"
            fill={color}
        />
    );
}

function starPoints(cx: number, cy: number, outer: number, inner: number): string {
    const pts: string[] = [];
    for (let k = 0; k < 5; k++) {
        const ao = ((-90 + 72 * k) * Math.PI) / 180;
        const ai = ((-54 + 72 * k) * Math.PI) / 180;
        pts.push(`${(cx + outer * Math.cos(ao)).toFixed(2)},${(cy + outer * Math.sin(ao)).toFixed(2)}`);
        pts.push(`${(cx + inner * Math.cos(ai)).toFixed(2)},${(cy + inner * Math.sin(ai)).toFixed(2)}`);
    }
    return pts.join(" ");
}

/** 6. General token — low forage cap with a star, mustache, olive tunic */
export function GeneralToken({ size }: { size?: string }) {
    return (
        <PortraitToken
            rimLight="#e2bc6a" rimDark="#8a5c14"
            bgLight="#f2c878" bgDark="#b06e20"
            size={size}
        >
            {/* Neck, shoulders, head */}
            <rect x="23.1" y="28.5" width="5.8" height="6" fill="#d49a64" />
            <Bust clothing="#57633a" />
            <ellipse cx="26" cy="32.4" rx="2.9" ry="1.3" fill="#b57e4c" />
            <ellipse cx="26" cy="22" rx="8.8" ry="10" fill="#d49a64" />
            {/* Forage cap worn low */}
            <path d="M 16.9 18 C 16.4 10.8 20 8.6 26 8.6 C 32 8.6 35.6 10.8 35.1 18 C 30 15.4 22 15.4 16.9 18 Z" fill="#5c6636" />
            <path d="M 16.9 18 C 22 15.4 30 15.4 35.1 18 L 35.1 20 C 30 17.4 22 17.4 16.9 20 Z" fill="#454e26" />
            <polygon points={starPoints(26, 16.7, 1.6, 0.7)} fill="#e2bc6a" />
            {/* Collar + tunic buttons */}
            <rect x="22.8" y="31.2" width="6.4" height="2.4" rx="1" fill="#3f4826" />
            <circle cx="26" cy="36.6" r="0.7" fill="#e2bc6a" />
            <circle cx="26" cy="39.8" r="0.7" fill="#e2bc6a" />
            {/* Stern brows */}
            <path d="M 20.5 19.5 Q 22.3 19.1 24 20 M 31.5 19.5 Q 29.7 19.1 28 20" fill="none" stroke="#33220f" strokeWidth="1" strokeLinecap="round" />
            <Eyes color="#2a1a08" />
            <Nose color="#b57e4c" />
            <Mustache color="#33220f" />
            <path d="M 24.7 28.6 Q 26 29.1 27.3 28.6" fill="none" stroke="#8a5636" strokeWidth="0.8" strokeLinecap="round" />
        </PortraitToken>
    );
}

/** 7. Culture token — smiling woman, curly hair, gold dress and jewelry */
export function CultureToken({ size }: { size?: string }) {
    return (
        <PortraitToken
            rimLight="#e2bc6a" rimDark="#8a5c14"
            bgLight="#e8daf4" bgDark="#9a72c2"
            size={size}
        >
            {/* Curly hair mass behind the face */}
            <ellipse cx="26" cy="16.5" rx="11.8" ry="9.2" fill="#2a1608" />
            <ellipse cx="14.9" cy="23.5" rx="4.2" ry="7.2" fill="#2a1608" />
            <ellipse cx="37.1" cy="23.5" rx="4.2" ry="7.2" fill="#2a1608" />
            {/* Neck, shoulders, head */}
            <rect x="23.1" y="28.5" width="5.8" height="6" fill="#a86e42" />
            <Bust clothing="#d89420" />
            <ellipse cx="26" cy="32.4" rx="2.9" ry="1.3" fill="#8a5630" />
            <ellipse cx="26" cy="22" rx="8.8" ry="10" fill="#a86e42" />
            {/* Front curls framing the face */}
            <circle cx="26" cy="11.6" r="2.7" fill="#2a1608" />
            <circle cx="20.6" cy="13.1" r="2.5" fill="#2a1608" />
            <circle cx="31.4" cy="13.1" r="2.5" fill="#2a1608" />
            <circle cx="18.4" cy="16.2" r="2.3" fill="#2a1608" />
            <circle cx="33.6" cy="16.2" r="2.3" fill="#2a1608" />
            <circle cx="17.3" cy="20" r="2.1" fill="#3d2410" />
            <circle cx="34.7" cy="20" r="2.1" fill="#3d2410" />
            {/* Brows */}
            <path d="M 20.7 19.5 Q 22.3 18.8 23.9 19.4 M 28.1 19.4 Q 29.7 18.8 31.3 19.5" fill="none" stroke="#241206" strokeWidth="0.9" strokeLinecap="round" />
            <Eyes color="#1a0e04" />
            <Nose color="#7c4e28" />
            {/* Big open smile */}
            <path d="M 22.6 26.2 Q 26 27.3 29.4 26.2 Q 29 30.7 26 30.9 Q 23 30.7 22.6 26.2 Z" fill="#f6efe4" stroke="#5f2a1a" strokeWidth="0.7" strokeLinejoin="round" />
            {/* Hoop earrings */}
            <circle cx="16.6" cy="27" r="1.9" fill="none" stroke="#f0c050" strokeWidth="1.3" />
            <circle cx="35.4" cy="27" r="1.9" fill="none" stroke="#f0c050" strokeWidth="1.3" />
            {/* Necklace + gem */}
            <path d="M 21.6 33.6 Q 26 36.6 30.4 33.6" fill="none" stroke="#f2cc66" strokeWidth="1.1" />
            <circle cx="26" cy="35.7" r="1.4" fill="#2ea86a" stroke="#f2cc66" strokeWidth="0.5" />
        </PortraitToken>
    );
}

/** 8. Financier token — slicked hair, round glasses, mustache, suit and tie */
export function FinancierToken({ size }: { size?: string }) {
    return (
        <PortraitToken
            rimLight="#b0bcc8" rimDark="#4e5a66"
            bgLight="#9cc8e8" bgDark="#2c6494"
            size={size}
        >
            {/* Neck, shoulders, head */}
            <rect x="23.1" y="28.5" width="5.8" height="6" fill="#ecd0b0" />
            <Bust clothing="#232f4e" />
            <ellipse cx="26" cy="32.4" rx="2.9" ry="1.3" fill="#d0ac86" />
            {/* Shirt, tie, lapels */}
            <polygon points="23.2,30.9 28.8,30.9 26,36.6" fill="#e9e9ef" />
            <polygon points="25.3,30.9 26.7,30.9 26.4,36.4 25.6,36.4" fill="#8a2432" />
            <path d="M 23.2 30.9 L 24.7 34.8 M 28.8 30.9 L 27.3 34.8" stroke="#101a30" strokeWidth="0.9" />
            <ellipse cx="26" cy="22" rx="8.8" ry="10" fill="#ecd0b0" />
            {/* Slicked-back hair */}
            <path d="M 17.2 22.8 C 17 12.4 20.2 11 26 11 C 31.8 11 35 12.4 34.8 22.8 C 34.3 17.2 32.2 14.9 28.6 14.8 C 24.4 14.7 19.8 15.6 17.2 22.8 Z" fill="#2e2018" />
            <Nose color="#d0ac86" />
            <Mustache color="#3a2a1a" />
            <path d="M 24.6 28.9 Q 26 29.6 27.4 28.9" fill="none" stroke="#b07a56" strokeWidth="0.8" strokeLinecap="round" />
            {/* Round glasses: light glass tint + dark rims, eyes drawn above the tint */}
            <g fill="#d9ecf8" fillOpacity="0.85" stroke="#2c3440" strokeWidth="1.2">
                <circle cx="22.2" cy="21.6" r="3.4" />
                <circle cx="29.8" cy="21.6" r="3.4" />
            </g>
            <Eyes color="#2a3038" />
            <path d="M 25.2 21.2 Q 26 20.7 26.8 21.2 M 18.8 21 L 17.3 20.4 M 33.2 21 L 34.7 20.4" fill="none" stroke="#2c3440" strokeWidth="1.2" strokeLinecap="round" />
        </PortraitToken>
    );
}
