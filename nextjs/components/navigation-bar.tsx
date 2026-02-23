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
import { EloWebServiceBaseUrl } from "@/app/api"
import { useSettings } from "@/app/settingsContext"
import { useMe } from "@/app/meContext"
import { NavigationMenuSub } from "@radix-ui/react-navigation-menu"
import { useTheme } from "next-themes"
import { Moon, Sun, Code2, Settings, LogIn } from "lucide-react"

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

              <ModeToggleSubMenu />
              <ListItem href="https://github.com/Tolyandre/elo" title={
                <>
                  <Code2 className="inline-block mr-2 h-6 w-6 align-middle" />
                  Исходный код
                </>
              }>
              </ListItem>

              <ListItem href="/admin" title={
                <>
                  <Settings className="inline-block mr-2 h-6 w-6 align-middle" />
                  Админка
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
                        <LogIn className="inline-block mr-2 h-6 w-6 align-middle" />
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

function ModeToggleSubMenu() {
  const { setTheme } = useTheme()

  return (
    <NavigationMenuSub defaultValue="">
      <NavigationMenuList>
        <NavigationMenuItem value="sub1">
          <NavigationMenuTrigger>
            <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
            <Moon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
            <span className="sr-only">Тема</span>
          </NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul>
              <ListItem title="Светлая" onClick={() => setTheme("light")} />
              <ListItem title="Темная" onClick={() => setTheme("dark")} />
              <ListItem title="Системная" onClick={() => setTheme("system")} />
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenuSub>
  )
}

