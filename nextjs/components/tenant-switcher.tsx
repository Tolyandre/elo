"use client"

import { Check, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTenantScope } from "@/app/tenantScopeContext"
import { useTenants } from "@/app/tenantsContext"

/**
 * The current tenant's name with the switcher (ADR-36 phase 4): the header
 * identity of the community whose arena, feed and profiles render. Hidden
 * until the tenant list arrives; picking an item switches the community in
 * place (the URL carries ?tenant=, the pages re-render).
 */
export function TenantSwitcher() {
  const { tenants } = useTenants()
  const { tenant, setTenant } = useTenantScope()

  if (tenants.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 max-w-[10rem] gap-1.5 px-2"
          aria-label="Сообщество"
        >
          <Users className="h-4 w-4 shrink-0" />
          <span className="truncate">{tenant?.name ?? "Сообщество"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {tenants.map((t) => (
          <DropdownMenuItem key={t.id} onClick={() => setTenant(t.id)}>
            <Check className={`mr-1 h-4 w-4 shrink-0 ${t.id === tenant?.id ? "opacity-100" : "opacity-0"}`} />
            <span className="truncate">{t.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
