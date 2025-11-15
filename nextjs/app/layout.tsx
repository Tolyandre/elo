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

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Board games elo",
  description: "Calculate elo rating for board game players",
  icons: {
    icon: "favicon-st-patrick.ico",
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
          <MatchesProvider>
            <PlayersProvider>
              <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
                <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
                  <div className="min-h-screen ">
                    <NavigationBar />
                    <div className="font-sans flex items-center justify-center p-8 rounded-lg shadow-md max-w-lg w-full">
                      <PingError />
                      {children}
                    </div>
                  </div>
                </ThemeProvider>
              </body>
            </PlayersProvider>
          </MatchesProvider>
        </MeProvider>
      </SettingsProvider>
    </html>
  );
}
