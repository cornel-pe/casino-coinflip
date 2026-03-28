import { Suspense, type ReactNode } from 'react';
import './globals.css';
import ThemeFromUrl from './theme-from-url';

export const metadata = {
  title: 'CoinFlip',
  description: 'CoinFlip game',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg dark">
        <Suspense fallback={null}>
          <ThemeFromUrl />
        </Suspense>
        {children}
      </body>
    </html>
  );
}

