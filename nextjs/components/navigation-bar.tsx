"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { useIsMobile } from "@/hooks/use-is-mobile"
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu"
import { cn } from "@/lib/utils"
import { setUrlQuery } from "@/lib/url-state"
import { loginUrl } from "@/lib/login-url"
import { redirectTo } from "@/lib/redirect"
import { useMe } from "@/app/meContext"
import { useTenantScope } from "@/app/tenantScopeContext"
import { useTenants } from "@/app/tenantsContext"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { TenantIcon } from "@/components/tenant-icon"
import { Check, ChevronDown, CircleHelp, LogOut, LayoutGrid, Menu, Settings, SlidersHorizontal, Trophy, Users } from "lucide-react"
import { SiGithub, SiGoogle } from "@icons-pack/react-simple-icons"

export function NavigationBar() {
    const isMobile = useIsMobile()
    const me = useMe();
    const pathname = usePathname();
    const { tenant, ready: tenantReady, setTenant } = useTenantScope();
    const { tenants } = useTenants();

  // The nav item is the tenant's main page (ADR-36), and the chevron next to
  // it opens the switcher (with a single tenant there is nothing to switch
  // to, so the chevron stays hidden). From any other route the Link is a
  // normal cross-route client navigation. On / itself the router would drop a
  // query-only change (a static-export no-op), so clearing the arena state
  // goes through the History API instead; the arena view derives everything
  // from the query and falls back to its defaults. The tenant survives the
  // reset — every navigation preserves it until the user switches it.
  function goHome(e: React.MouseEvent) {
    if (pathname !== "/" || window.location.search === "") return;
    e.preventDefault();
    setUrlQuery((params) => {
      const tenant = params.get("tenant");
      for (const key of [...params.keys()]) params.delete(key);
      if (tenant) params.set("tenant", tenant);
    }, "push");
  }
  const tenantHomeHref = tenant ? `/?tenant=${tenant.id}` : "/";
  // The nav item IS the current community (ADR-36): its name links to the
  // tenant's main page. Before the tenant scope resolves it shows a skeleton
  // — never the retired global-arena «Главная» fallback.

  return (
    <NavigationMenu viewport={isMobile.isMobile} delayDuration={0} className="max-w-none">
      <NavigationMenuList className="flex-nowrap gap-0">
        <NavigationMenuItem className="flex items-center">
          {/* NavigationMenuLink's own base classes carry flex-col gap-1 p-2 —
              fine for the former text-only «Главная», stacking for an
              icon+name pair: flex-row here lets tailwind-merge win over it. */}
          <NavigationMenuLink asChild className={cn(navigationMenuTriggerStyle(), "min-w-0 flex-row gap-1 px-1.5 sm:px-2")}>
            <Link href={tenantHomeHref} onClick={goHome} aria-label="На главную сообщества" className="min-w-0">
              {!tenantReady ? (
                // Scope still resolving (initial loads): a quiet skeleton in
                // place of the name.
                <>
                  <Users className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                  <span className="truncate max-w-[6rem] sm:max-w-[8rem]">
                    <span className="block h-4 w-16 animate-pulse rounded bg-muted-foreground/20" aria-hidden="true" />
                    <span className="sr-only">Загрузка сообщества…</span>
                  </span>
                </>
              ) : (
                <>
                  {tenant ? <TenantIcon icon={tenant.icon} className="h-4 w-4" /> : <Users className="h-4 w-4 shrink-0" />}
                  <span className="truncate max-w-[8rem] sm:max-w-[12rem]">{tenant?.name ?? "Выберите сообщество"}</span>
                </>
              )}
            </Link>
          </NavigationMenuLink>
          {tenants.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 px-1" aria-label="Выбрать сообщество">
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {tenants.map((t) => (
                  <DropdownMenuItem key={t.id} onClick={() => setTenant(t.id)}>
                    <Check className={`mr-1 h-4 w-4 shrink-0 ${t.id === tenant?.id ? "opacity-100" : "opacity-0"}`} />
                    <TenantIcon icon={t.icon} className="mr-1 h-4 w-4" />
                    <span className="truncate">{t.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </NavigationMenuItem>

        <NavigationMenuItem>
          {/* flex-row: NavigationMenuLink's base carries flex-col (for the
              dropdown's stacked link content) — without the override the
              icon stacks above the text and the label drops out of the row. */}
          <NavigationMenuLink asChild className={cn(navigationMenuTriggerStyle(), "flex-row gap-1 px-1.5 sm:px-2")}>
            <Link href="/help">
              <CircleHelp className="h-4 w-4 shrink-0" />
              Справка
            </Link>
          </NavigationMenuLink>
        </NavigationMenuItem>

        <NavigationMenuItem>
          <NavigationMenuTrigger className="px-1.5 sm:px-2">
            <Menu className="h-4 w-4 mr-1" />
            Меню
          </NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid gap-2 md:w-[400px] lg:w-[500px] lg:grid-cols-[.75fr_1fr]">

              <ListItem href="/calculators" title={
                <>
                  <LayoutGrid className="inline-block mr-2 h-6 w-6 align-middle" />
                  Калькуляторы
                </>
              } />

              {/* Ставки живут на главной («Ставки» после «Сейчас играют»
                  и лента), создание рынка — таб на /new. */}

              <ListItem href="/arenas" title={
                <>
                  <Trophy className="inline-block mr-2 h-6 w-6 align-middle" />
                  Арены
                </>
              } />

              {/* Турниры живут табом на /arenas, отдельного пункта больше нет. */}

              <ListItem href="/admin" title={
                <>
                  <Settings className="inline-block mr-2 h-6 w-6 align-middle" />
                  Админка
                </>
              } />

              <ListItem href="/settings" title={
                <>
                  <SlidersHorizontal className="inline-block mr-2 h-6 w-6 align-middle" />
                  Мои настройки
                </>
              } />

              <ListItem href="https://github.com/Tolyandre/elo" title={
                <>
                  <SiGithub className="inline-block mr-2 h-6 w-6 align-middle" />
                  Исходный код
                </>
              } />

              {(() => {
                if (me.id) {
                  return (
                    <ListItem onClick={me.logout} title={
                      <>
                        <LogOut className="inline-block mr-2 h-6 w-6 align-middle" />
                        Выйти
                      </>
                    } >
                      {me.name}
                    </ListItem>
                  );
                }

                return (
                  <ListItem onClick={() => redirectTo(loginUrl())} title={
                    <>
                      <SiGoogle className="inline-block mr-2 h-6 w-6 align-middle" />
                      Войти
                    </>
                  } />
                );
              })()}

            </ul>

          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  )
}

function ListItem({
  title,
  children,
  href,
  onClick,
  ...props
}: Omit<React.ComponentPropsWithoutRef<"li">, "title"> & { href?: string; title: React.ReactNode; onClick?: () => void }) {
  return (
    <li {...props}>
      <NavigationMenuLink asChild>
        {href ? (
          <Link href={href}>
            <div className="text-sm leading-none font-medium">
              {title}
            </div>
            <p className="text-muted-foreground line-clamp-2 text-sm leading-snug">
              {children}
            </p>
          </Link>
        ) : (
          <button type="button" onClick={onClick} className="w-full text-left">
            <div className="text-sm leading-none font-medium">
              {title}
            </div>
            <p className="text-muted-foreground line-clamp-2 text-sm leading-snug">
              {children}
            </p>
          </button>
        )}
      </NavigationMenuLink>
    </li>
  )
}
