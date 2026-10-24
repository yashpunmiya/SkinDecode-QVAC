import type { Metadata, Viewport } from 'next';
import './globals.css';
import { siteConfig } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.origin),
  title: { default: 'SkinDecode — Understand your skin. Simplify your skincare.', template: '%s | SkinDecode' },
  description: 'A clearer way to understand your skin and the products you use.',
  applicationName: 'SkinDecode',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'SkinDecode',
    title: 'Understand your skin. Simplify your skincare.',
    description: 'Build a skincare profile, understand product ingredients, shape a routine, and notice how your skin changes over time.',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'SkinDecode — a clearer way to understand your skin' }],
  },
  twitter: { card: 'summary_large_image', title: 'SkinDecode', description: 'A little more clarity for your everyday skincare.', images: ['/opengraph-image'] },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 } },
  icons: { icon: '/brand/favicon.svg', apple: '/brand/app-icon.png' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#fafaf7' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const orgSchema = {
    '@context': 'https://schema.org', '@type': 'Organization', name: 'SkinDecode', url: siteConfig.origin,
    logo: `${siteConfig.origin}/brand/app-icon.png`, description: 'A skincare app for understanding product formulas, shaping routines, and tracking changes over time.',
    ...(siteConfig.supportEmail ? { email: siteConfig.supportEmail } : {}),
  };
  const appSchema = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'SkinDecode', applicationCategory: 'HealthApplication', operatingSystem: 'Android, iOS',
    description: 'A skincare companion with a personal skin profile, ingredient insights, routine planning, and local skin tracking.',
    url: siteConfig.origin,
  };
  return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to content</a><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify([orgSchema, appSchema]).replace(/</g, '\\u003c') }} />{children}</body></html>;
}
