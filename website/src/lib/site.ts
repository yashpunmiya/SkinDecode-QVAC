const clean = (value: string | undefined) => value?.trim().replace(/\/$/, '') || '';

export const siteConfig = {
  name: 'SkinDecode',
  origin: clean(process.env.NEXT_PUBLIC_SITE_URL) || 'https://tryskindecode.online',
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || '',
  legalEntity: process.env.NEXT_PUBLIC_LEGAL_ENTITY?.trim() || '',
  governingLaw: process.env.NEXT_PUBLIC_GOVERNING_LAW?.trim() || '',
  iosUrl: process.env.NEXT_PUBLIC_IOS_APP_URL?.trim() || '',
  androidUrl: process.env.NEXT_PUBLIC_ANDROID_APP_URL?.trim() || '',
};

export const pageMetadata = {
  home: {
    title: 'Understand your skin. Simplify your skincare.',
    description: 'Build a skincare profile, understand product ingredients, shape a routine, and notice how your skin changes over time with SkinDecode.',
  },
  features: {
    title: 'Skincare tools made personal',
    description: 'Explore SkinDecode product ingredient insights, personalized Skin Match, routine planning, skin check-ins, and your skincare shelf.',
  },
  about: {
    title: 'A clearer way to understand your skin',
    description: 'SkinDecode helps make skincare information easier to understand, with a profile-led product view and tools for everyday consistency.',
  },
  faq: {
    title: 'Frequently asked questions',
    description: 'Answers about SkinDecode product insights, privacy, local tracking, routines, reminders, and availability.',
  },
  privacy: {
    title: 'Privacy policy',
    description: 'How SkinDecode handles account, profile, product, routine, skin check-in, location, notification, and locally stored data.',
  },
  terms: {
    title: 'Terms of service',
    description: 'Terms for using SkinDecode’s skincare information and wellbeing tools. This draft requires operator and governing-law details before public launch.',
  },
  support: {
    title: 'Support',
    description: 'Get help with SkinDecode sign-in, product information, routines, privacy, and app settings.',
  },
  contact: {
    title: 'Contact SkinDecode',
    description: 'Find verified contact information for SkinDecode. Public contact details are not configured yet.',
  },
  deleteAccount: {
    title: 'Delete your SkinDecode account',
    description: 'Securely delete a SkinDecode account and its cloud records in the app or from the account deletion website.',
  },
} as const;

export const navItems = [
  { href: '/', label: 'Home' },
  { href: '/features', label: 'Features' },
  { href: '/about', label: 'Our approach' },
  { href: '/faq', label: 'FAQ' },
];

export const legalLinks = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/support', label: 'Support' },
  { href: '/delete-account', label: 'Delete account' },
];

export function metadataForPage(path: string, title: string, description: string) {
  const fullTitle = `${title} | SkinDecode`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: 'website' as const, siteName: 'SkinDecode', title: fullTitle, description, url: `${siteConfig.origin}${path}`, images: [{ url: `${siteConfig.origin}/opengraph-image`, width: 1200, height: 630, alt: 'SkinDecode — a clearer way to understand your skin' }] },
    twitter: { card: 'summary_large_image' as const, title: fullTitle, description, images: [`${siteConfig.origin}/opengraph-image`] },
  };
}
