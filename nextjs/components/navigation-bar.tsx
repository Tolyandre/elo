"use client"

import * as React from "react"
import Link from "next/link"

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
import { usePlayers } from "@/app/players/PlayersContext"
import { useMatches } from "@/app/matches/MatchesContext"
import { EloWebServiceBaseUrl } from "@/app/api"
import { useMe } from "@/app/meContext"
import { Settings, LogOut, SlidersHorizontal, Skull, Crosshair } from "lucide-react"
import { SiGithub, SiGoogle } from "@icons-pack/react-simple-icons"

export function NavigationBar() {
  const isMobile = useIsMobile()
  const { invalidate: invalidatePlayers } = usePlayers();
  const { invalidate: invalidateMatches } = useMatches();
  const me = useMe();

  return (
    <NavigationMenu viewport={isMobile.isMobile} delayDuration={0}>
      <NavigationMenuList className="flex-wrap">
        <NavigationMenuItem>
          <NavigationMenuTrigger>Меню</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid gap-2 md:w-[400px] lg:w-[500px] lg:grid-cols-[.75fr_1fr]">

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

              <ListItem href="/calculators/skull-king" title={
                <>
                  <Skull className="inline-block mr-2 h-6 w-6 align-middle" />
                  Skull King
                </>
              } />

              <ListItem href="/calculators/st-patrick" title={
                <>
                  <Crosshair className="inline-block mr-2 h-6 w-6 align-middle" />
                  Охота на змей
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
                  <ListItem href={`${EloWebServiceBaseUrl}/auth/login`} title={
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

        <NavigationMenuItem>
          <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
            <Link href="/players">Игроки</Link>
          </NavigationMenuLink>
        </NavigationMenuItem>

        <NavigationMenuItem>
          <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
            <Link href="/matches">Партии</Link>
          </NavigationMenuLink>
        </NavigationMenuItem>

        <NavigationMenuItem>
          <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
            <Link href="/help">Справка</Link>
          </NavigationMenuLink>
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
