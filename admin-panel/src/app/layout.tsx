import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fracture MC FriendConnect',
  description: 'Private FriendConnect administration panel for Fracture MC.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
