import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Flux4Bots Demo' };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-[100dvh]">
      <body className="h-full overflow-hidden bg-white antialiased">
        {/* Ensure every page can take full viewport height */}
        <div className="h-full">{children}</div>
      </body>
    </html>
  );
}

