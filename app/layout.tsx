import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DataProvider } from "@/components/data";
import { Shell } from "@/components/Shell";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

const themeBoot = `(function(){try{var p=JSON.parse(localStorage.getItem("mirror.prefs.v1")||"{}");var t=p.theme||"dark";if(t==="system"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t;document.documentElement.dataset.themeChoice=p.theme||"dark"}catch(e){document.documentElement.dataset.theme="dark"}})();`;

export const metadata: Metadata = {
  title: "Mirror",
  description: "Personal read-only mirror of University of Arkansas Blackboard and Pearson MyLab.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>
        <DataProvider>
          <Shell>{children}</Shell>
        </DataProvider>
      </body>
    </html>
  );
}
