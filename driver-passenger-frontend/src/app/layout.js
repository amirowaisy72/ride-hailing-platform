import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { ActionDialogProvider } from "@/components/ActionDialog";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { themeBootScript } from "@/components/theme/themeScript";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { languageBootScript } from "@/components/i18n/languageScript";
import { BRAND } from "@/config/brand";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: {
    default: BRAND.name,
    template: `%s | ${BRAND.name}`,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Where the platform supports it, the layout viewport resizes with
  // the on-screen keyboard instead of being overlaid by it, so dvh-sized
  // sheets stay reachable. Unsupported WebViews ignore it — the search
  // surfaces additionally size from window.visualViewport (Round 5).
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0d10" },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Applies the saved/system theme before first paint (prevents flashing). */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        {/* Applies the saved language (dir/lang/font) before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: languageBootScript }} />
        {/* Noto Nastaliq Urdu — used only when Urdu mode is active
            (html.lang-ur); display=swap keeps Latin UI instant. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <LanguageProvider>
            <AuthProvider>
              <ActionDialogProvider>{children}</ActionDialogProvider>
            </AuthProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
