import type { Metadata, Viewport } from "next";
import { Geist, Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import { DESIGN_INIT_SCRIPT } from "@/lib/design";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

// Arc's display face (headings in the Arc design). The CSS variable name is the one Arc's foundation reads.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "BizzFlow",
  description: "WifiBizz Crawler & Bill Generator",
  // Icons come from the file conventions in this directory — favicon.ico,
  // icon.png and apple-icon.png. An `icons` field here would override them.
  appleWebApp: {
    title: "BizzFlow",
    capable: true,
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#635BFF",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geist.variable} ${jetbrainsMono.variable} h-full antialiased`}
      // The design script below sets data-design / data-accent before hydration.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: DESIGN_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
