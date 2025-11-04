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
import RefreshButton from "./refresh-button"
import { usePlayers } from "@/app/players/PlayersContext"
import { useMatches } from "@/app/matches/MatchesContext"
import { EloWebServiceBaseUrl, getMe, User } from "@/app/api"

export function NavigationBar() {
  const isMobile = useIsMobile()
  const { invalidate: invalidatePlayers } = usePlayers();
  const { invalidate: invalidateMatches } = useMatches();
  const [me, setMe] = React.useState<{ data: User | undefined } | undefined>(undefined);

  React.useEffect(() => {
    getMe()
      .then((user) => {
        setMe(user);
      })
      .catch(() => {
        setMe(undefined);
      });
  }, []);


  return (
    <NavigationMenu viewport={isMobile.isMobile} delayDuration={0}>
      <NavigationMenuList className="flex-wrap">
        <NavigationMenuItem>
          <NavigationMenuTrigger>Home</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid gap-2 md:w-[400px] lg:w-[500px] lg:grid-cols-[.75fr_1fr]">
              <li className="row-span-3">
                <NavigationMenuLink asChild>
                  <a
                    className="from-muted/50 to-muted flex h-full w-full flex-col justify-end rounded-md bg-linear-to-b p-4 no-underline outline-hidden transition-all duration-200 select-none focus:shadow-md md:p-6"
                    href="./"
                  >
                    <div className="mb-2 text-lg font-medium sm:mt-4">
                      Рейтинг эло
                    </div>
                    <p className="text-muted-foreground text-sm leading-tight">
                      для настольных игр
                    </p>
                  </a>
                </NavigationMenuLink>
              </li>
              <ListItem href="https://docs.google.com/spreadsheets/d/1bf6bmd63dvO9xjtnoTGmkcWJJE0NetQRjKkgcQvovQQ" title="Google sheet">
                Таблица с партиями и расчетом рейтинга
              </ListItem>
              <ListItem href="https://github.com/Tolyandre/elo" title="GitHub">
                Исходный код этого приложения
              </ListItem>
              <li>
                <RefreshButton onInvalidate={() => {
                  invalidatePlayers();
                  invalidateMatches();
                }} />
              </li>

              {(() => {
                if (me && me.data?.id) {
                  return (
                    <li>
                      <form action={`${EloWebServiceBaseUrl}/auth/logout`} method="post">
                        <NavigationMenuLink asChild>
                          <button type="submit" className="w-full text-left">
                            <div className="text-sm leading-none font-medium">Выйти</div>
                            <p className="text-muted-foreground line-clamp-2 text-sm leading-snug">
                              {me.data.name}
                            </p>
                          </button>
                        </NavigationMenuLink>
                      </form>
                    </li>
                  );
                }

                return (
                  <ListItem href={`${EloWebServiceBaseUrl}/auth/login`} title="Войти">
                    Через Google
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
  ...props
}: React.ComponentPropsWithoutRef<"li"> & { href: string }) {
  return (
    <li {...props}>
      <NavigationMenuLink asChild>
        <Link href={href}>
          <div className="text-sm leading-none font-medium">{title}</div>
          <p className="text-muted-foreground line-clamp-2 text-sm leading-snug">
            {children}
          </p>
        </Link>
      </NavigationMenuLink>
    </li>
  )
}
