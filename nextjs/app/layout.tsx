import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { PlayersProvider } from "./players/PlayersContext";
import { MatchesProvider } from "./matches/MatchesContext";
import { SettingsProvider } from "./settingsContext";
import { SiteHeader } from "@/components/site-header";
import { PageHeaderProvider } from "./pageHeaderContext";
import { ThemeProvider } from "./theme-provider";
import { MeProvider } from "./meContext";
import { Toaster } from "@/components/ui/sonner";
import { GamesProvider } from "./gamesContext";
import { ClubsProvider } from "./clubsContext";
import { TournamentsProvider } from "./tournamentsContext";
import { OfflineProvider } from "./offline/OfflineContext";
import { SwUpdateReloader } from "@/components/sw-update-reloader";
import { EnvBanner } from "@/components/env-banner";

export const metadata: Metadata = {
  metadataBase: new URL("https://tolyandre.github.io/elo"),
  title: {
    default: "Board Games Elo",
    template: "%s | Board Games Elo",
  },
  description: "Отслеживайте Elo-рейтинг игроков в настольных играх.",
  openGraph: {
    type: "website",
    siteName: "Board Games Elo",
    title: "Board Games Elo",
    description: "Отслеживайте Elo-рейтинг игроков в настольных играх.",
    images: [{ url: "og-image.png", width: 1200, height: 630, alt: "Board Games Elo" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Board Games Elo",
    description: "Отслеживайте Elo-рейтинг игроков в настольных играх.",
  },
  icons: {
    icon: [
      { url: "favicon.ico", sizes: "any" },
      { url: "clover-icon-notext.svg", type: "image/svg+xml" },
    ],
  },
  verification: {
    google: "WXW-hO-W47nHNwMROtsuNMdRKlQbIs4w4x8Jbutfw7Y",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang="en" suppressHydrationWarning /* suppress for ThemeProvider */>
      <SettingsProvider>
        <MeProvider>
          <GamesProvider>
            <ClubsProvider>
            <TournamentsProvider>
            <MatchesProvider>
              <PlayersProvider>
                <OfflineProvider>
                <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
                  <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
                    <script
                      type="application/ld+json"
                      dangerouslySetInnerHTML={{
                        __html: JSON.stringify({
                          "@context": "https://schema.org",
                          "@type": "WebApplication",
                          name: "Board Games Elo",
                          url: "https://tolyandre.github.io/elo",
                          description: "Отслеживайте Elo-рейтинг игроков в настольных играх.",
                          applicationCategory: "GameApplication",
                          inLanguage: "ru",
                        }),
                      }}
                    />
                    <Toaster />
                    <SwUpdateReloader />
                    <div className="flex flex-col min-h-screen">
                      <EnvBanner />
                      <div className="font-sans flex flex-col items-center flex-1">
                        <PageHeaderProvider>
                          <div className="flex flex-col w-full max-w-5xl rounded-lg shadow-md">
                            <SiteHeader />
                            <div className="p-3">
                              {children}
                            </div>
                          </div>
                        </PageHeaderProvider>
                      </div>
                    </div>
                  </ThemeProvider>
                </body>
                </OfflineProvider>
              </PlayersProvider>
            </MatchesProvider>
            </TournamentsProvider>
            </ClubsProvider>
          </GamesProvider>
        </MeProvider>
      </SettingsProvider>
    </html>
  );
}
