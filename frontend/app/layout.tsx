import "./globals.css";
import "./controls.css";
import Script from "next/script";

export const metadata = { title: "Agent Control Plane", description: "Taskmaster agent operations dashboard" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />{children}</body></html>;
}
