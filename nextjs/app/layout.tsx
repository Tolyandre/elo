import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PlayersProvider } from "./players/PlayersContext";
import { MatchesProvider } from "./matches/MatchesContext";
import { SettingsProvider } from "./settingsContext";
import { NavigationBar } from "@/components/navigation-bar";
import { PingError } from "@/components/ping-error";
import { ThemeProvider } from "./theme-provider";
import { MeProvider } from "./meContext";
import { Toaster } from "@/components/ui/sonner";
import { GamesProvider } from "./gamesContext";
import { ClubsProvider } from "./clubsContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
    icon: "favicon-st-patrick.ico",
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
            <MatchesProvider>
              <PlayersProvider>
                <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
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
                    <div className="font-sans items-center justify-items-center min-h-screen">
                      <div className="flex flex-col mx-auto rounded-lg shadow-md max-w-5xl">
                        <NavigationBar />
                        <div className="p-3 pt-6">
                          <PingError />
                          {children}
                        </div>
                      </div>

                    </div>
                  </ThemeProvider>
                </body>
              </PlayersProvider>
            </MatchesProvider>
            </ClubsProvider>
          </GamesProvider>
        </MeProvider>
      </SettingsProvider>
    </html>
  );
}
