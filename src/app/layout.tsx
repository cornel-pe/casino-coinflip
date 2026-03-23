import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'CoinFlip',
  description: 'CoinFlip game',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg min-h-screen">{children}</body>
    </html>
  );
}

