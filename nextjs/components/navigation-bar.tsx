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
import { ModeToggle } from "./mode-toggle"
import { usePlayers } from "@/app/players/PlayersContext"
import { useMatches } from "@/app/matches/MatchesContext"
import { deleteCache, EloWebServiceBaseUrl, User } from "@/app/api"
import { useSettings } from "@/app/settingsContext"
import { useMe } from "@/app/meContext"

export function NavigationBar() {
  const isMobile = useIsMobile()
  const { invalidate: invalidatePlayers } = usePlayers();
  const { invalidate: invalidateMatches } = useMatches();
  const settings = useSettings();
  const me = useMe();

  return (
    <NavigationMenu viewport={isMobile.isMobile} delayDuration={0}>
      <NavigationMenuList className="flex-wrap">
        <NavigationMenuItem>
          <NavigationMenuTrigger>Меню</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid gap-2 md:w-[400px] lg:w-[500px] lg:grid-cols-[.75fr_1fr]">
              <ListItem href={settings.googleSheetLink}
                title={
                  <>
                    <img src="https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_48dp.png" className="inline-block mr-2 h-6 w-6 align-middle" />
                    Таблица
                  </>
                }>
              </ListItem>
              <ListItem href="https://github.com/Tolyandre/elo" title={
                <>
                  <img src="https://github.githubassets.com/assets/GitHub-Mark-ea2971cee799.png" className="inline-block mr-2 h-6 w-6 align-middle" />
                  Исходный код
                </>
              }>
              </ListItem>

              <ListItem onClick={async () => {
                await deleteCache();
                invalidatePlayers();
                invalidateMatches();
                me.invalidate();
              }} title={
                <>
                  <svg viewBox="0 0 24 24" className="inline-block mr-2 h-6 w-6 align-middle" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M21 3V8M21 8H16M21 8L18 5.29168C16.4077 3.86656 14.3051 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21C16.2832 21 19.8675 18.008 20.777 14" />
                  </svg>
                  Обновить из таблицы
                </>
              }>
              </ListItem>

              {(() => {
                if (me.id) {
                  return (
                    <ListItem onClick={me.logout} title="Выйти" >
                      {me.name}
                    </ListItem>
                  );
                }

                return (
                  <ListItem href={`${EloWebServiceBaseUrl}/auth/login`} title=
                    {
                      <>
                        <img src="https://support.google.com/favicon.png" className="inline-block mr-2 h-6 w-6 align-middle" />
                        Войти
                      </>
                    }>
                  </ListItem>
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
            <Link href="/games">Игры</Link>
          </NavigationMenuLink>
        </NavigationMenuItem>

        <NavigationMenuItem>
          <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
            <ModeToggle />
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
