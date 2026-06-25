import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: 'Gerador de Briefing — LPX',
  description: 'Gere briefings de anúncio para microinfluenciadoras com a Metodologia LPX',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${montserrat.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#f4f4f4] text-[#1a1a1a]">{children}</body>
    </html>
  );
}
