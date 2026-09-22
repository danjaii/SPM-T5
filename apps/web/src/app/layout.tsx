import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ConnectSphere",
  description: "Event management platform",
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
