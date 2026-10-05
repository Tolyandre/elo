// Barrel over the domain API slices in ./api/. Import sites stay on
// "@/app/api"; to read or change one domain's calls, open ./api/<domain>.ts —
// agents and editors load only the slice they need.
export * from "./api/client";
export * from "./api/types";
export * from "./api/audit";
export * from "./api/auth";
export * from "./api/arenas";
export * from "./api/clubs";
export * from "./api/games";
export * from "./api/matches";
export * from "./api/markets";
export * from "./api/players";
export * from "./api/settings";
export * from "./api/tables";
export * from "./api/tournaments";
