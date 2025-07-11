import type { Metadata } from "next";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Toaster } from "~/components/ui/toaster";

import "./globals.css";

export const metadata: Metadata = {
  title: "Iterate",
  description: "",
  openGraph: {
    url: "https://iterate.com/",
    type: "website",
    title: "Iterate",
    description: "",
    images: {
      url: "https://iterate.com/og-image.png",
      alt: "Iterate",
    },
  },
  twitter: {
    card: "summary_large_image",
    title: "Iterate",
    description: "",
    images: ["https://iterate.com/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <GoogleAnalytics gaId="G-T9SJZX3ECG" />
        <script
          defer
          src="https://cloud.umami.is/script.js"
          data-website-id="8c8f7279-caa9-47b4-a0d2-b826f24ec084"
        ></script>
      </head>
      <body className="bg-white text-black min-h-screen">
        <div className="m-0 mb-12 md:mb-32 flex h-full items-center justify-center text-md">
          {children}
        </div>
        <Toaster />
      </body>
    </html>
  );
}
