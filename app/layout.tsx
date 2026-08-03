import type { Metadata } from "next";
import { publicBasePath, withBasePath } from "@/lib/public-path";
import "./globals.css";

const configuredOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "http://localhost:3000";
const origin = new URL(configuredOrigin).origin;
const siteUrl = `${origin}${publicBasePath}/`;
const socialImage = `${origin}${withBasePath("/og.png")}`;
const title = "RhymeGraph — Find the word that lands";
const description =
  "A private, on-device writing instrument for exploring rhyme by sound, meaning, and flow.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  alternates: { canonical: siteUrl },
  icons: {
    icon: withBasePath("/favicon.svg"),
    shortcut: withBasePath("/favicon.svg"),
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    title,
    description,
    images: [{ url: socialImage, width: 1728, height: 907, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [socialImage],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
