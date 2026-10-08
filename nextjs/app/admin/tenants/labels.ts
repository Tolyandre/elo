// Russian labels for the tenant openness settings (ADR-36), shared by the
// tenants admin pages.
import type { Tenant } from "@/app/api";

export const MEMBERSHIP_MODE_LABELS: Record<Tenant["arena_membership_mode"], string> = {
    all: "Все партии",
    any_member: "Есть участник сообщества",
    members_only: "Только участники сообщества",
};

export const TOURNAMENTS_OPENNESS_LABELS: Record<Tenant["tournaments_openness"], string> = {
    members_only: "Регистрация только для участников",
    open: "Открытая регистрация",
};
