import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PlayersProvider } from "./players/PlayersContext";
import { PingError } from "./components/ping-error";
import { NavigationBar } from "./components/navigation-bar";
import { MatchesProvider } from "./matches/MatchesContext";
import { SettingsProvider } from "./settingsContext";

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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <NavigationBar />
        <div className="min-h-screen flex items-center justify-center">
          <div className="font-sans items-center p-8 rounded-lg shadow-md max-w-lg w-full">
            <PingError />
            <SettingsProvider>
              <MatchesProvider>
                <PlayersProvider>{children}</PlayersProvider>
              </MatchesProvider>
            </SettingsProvider>
          </div>
        </div>
      </body>
    </html>
  );
}
