import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PlayersProvider } from "./PlayersContext";
import { PingError } from "./ping-error";

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
  description: "Put your board games score and calculate elo rating for players",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="min-h-screen flex items-center justify-center">
          <div className="font-sans items-center p-8 rounded-lg shadow-md max-w-sm w-full">
            <PingError />
            <PlayersProvider>{children}</PlayersProvider>
          </div>
        </div>
      </body>
    </html>
  );
}
