import type { MetadataRoute } from 'next';
import { siteConfig } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['', '/features', '/about', '/faq', '/privacy', '/terms', '/support', '/delete-account', '/contact'].map((path) => ({ url: `${siteConfig.origin}${path}`, changeFrequency: path === '' ? 'weekly' : 'monthly', priority: path === '' ? 1 : path === '/privacy' || path === '/delete-account' ? 0.65 : 0.8 }));
}
