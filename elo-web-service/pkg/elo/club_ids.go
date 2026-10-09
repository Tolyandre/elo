package elo

// BlueMenClubID is the well-known id of the «Синие люди» club (ADR-05/36) —
// one of the two clubs of the original «Синие люди» tenant. The row is seeded
// by schema migration 061 in every environment (alongside «Весёлые карточные
// игры», ...0002, and the plain group «тбонк», ...0003).
const blueMenClubIDUUID = "00000000-0000-0000-0000-000000000001"

var BlueMenClubID = mustParseID("elo: blue men club id", blueMenClubIDUUID)
