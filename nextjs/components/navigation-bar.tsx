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
import { EloWebServiceBaseUrl, getMe, logout, User } from "@/app/api"
import { useSettings } from "@/app/settingsContext"

export function NavigationBar() {
  const isMobile = useIsMobile()
  const { invalidate: invalidatePlayers } = usePlayers();
  const { invalidate: invalidateMatches } = useMatches();
  const settings = useSettings();
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
              {/* <li className="row-span-3">
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
              </li> */}
              <ListItem href={settings.googleSheetLink}
                title="Google sheet"
                imgSrc="https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_48dp.png">
                Партии и расчёт рейтинга
              </ListItem>
              <ListItem href="https://github.com/Tolyandre/elo" title="GitHub">
                <svg height="32" aria-hidden="true" viewBox="0 0 24 24" version="1.1" width="32" data-view-component="true" className="octicon octicon-mark-github v-align-middle">
                  <path d="M12 1C5.923 1 1 5.923 1 12c0 4.867 3.149 8.979 7.521 10.436.55.096.756-.233.756-.522 0-.262-.013-1.128-.013-2.049-2.764.509-3.479-.674-3.699-1.292-.124-.317-.66-1.293-1.127-1.554-.385-.207-.936-.715-.014-.729.866-.014 1.485.797 1.691 1.128.99 1.663 2.571 1.196 3.204.907.096-.715.385-1.196.701-1.471-2.448-.275-5.005-1.224-5.005-5.432 0-1.196.426-2.186 1.128-2.956-.111-.275-.496-1.402.11-2.915 0 0 .921-.288 3.024 1.128a10.193 10.193 0 0 1 2.75-.371c.936 0 1.871.123 2.75.371 2.104-1.43 3.025-1.128 3.025-1.128.605 1.513.221 2.64.111 2.915.701.77 1.127 1.747 1.127 2.956 0 4.222-2.571 5.157-5.019 5.432.399.344.743 1.004.743 2.035 0 1.471-.014 2.654-.014 3.025 0 .289.206.632.756.522C19.851 20.979 23 16.854 23 12c0-6.077-4.922-11-11-11Z"></path>
                </svg>
                Исходный код
              </ListItem>
              <li>
                <div className="text-sm leading-none font-medium">

                </div>
                <p className="text-muted-foreground line-clamp-2 text-sm leading-snug">
                  <RefreshButton onInvalidate={() => {
                    invalidatePlayers();
                    invalidateMatches();
                  }} /> Обновить из таблицы
                </p>
              </li>
              {(() => {
                if (me && me.data?.id) {
                  return (
                    <li>
                      <NavigationMenuLink asChild>
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={async () => {
                            await logout();
                            // TODO: 
                            setMe(undefined);
                          }}
                        >
                          <div className="text-sm leading-none font-medium">Выйти</div>
                          <p className="text-muted-foreground line-clamp-2 text-sm leading-snug">
                            {me?.data?.name}
                          </p>
                        </button>
                      </NavigationMenuLink>
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
  imgSrc,
  ...props
}: React.ComponentPropsWithoutRef<"li"> & { href: string, imgSrc?: string }) {
  return (
    <li {...props}>
      <NavigationMenuLink asChild>
        <Link href={href}>
          <div className="text-sm leading-none font-medium">
            {imgSrc && (<img src={imgSrc} className="inline-block mr-2 h-6 w-6 align-middle" />)}
            {title}
          </div>
          <p className="text-muted-foreground line-clamp-2 text-sm leading-snug">
            {children}
          </p>
        </Link>
      </NavigationMenuLink>
    </li>
  )
}
