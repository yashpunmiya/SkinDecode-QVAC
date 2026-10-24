# SkinDecode website

An independent Next.js App Router website in the `website/` folder. Public routes use server-rendered/static content; the account deletion route uses the public Supabase client for Google authentication and the existing self-service deletion Edge Function.

## Requirements

- Node.js 20.9 or newer (Node 22 LTS recommended)
- npm

## Local development

```powershell
cd website
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The example configuration uses the current public domain for canonical and sitemap URLs; override `NEXT_PUBLIC_SITE_URL` only when deploying to a different verified domain.

## Checks

```powershell
npm run lint
npm run typecheck
npm run build
```

## Vercel setup

1. Import the existing Git repository into Vercel.
2. Set **Root Directory** to `website` and allow Vercel to install dependencies from `website/package.json`.
3. Set the production environment variables listed below before the first production build.
4. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` so the external account deletion page can authenticate users and call the existing `delete-account` function. These are public client values; never add a service role key to the website.
5. In Supabase Auth URL Configuration, allow `https://tryskindecode.online/delete-account` and `http://localhost:3000/delete-account` as redirect URLs.
6. Deploy from Vercel.
5. Add the domain in Vercel project settings, configure the DNS records Vercel shows, and set `NEXT_PUBLIC_SITE_URL` to the final `https://` URL. Redeploy after changing it so canonical URLs, metadata, JSON-LD, robots, and sitemap use the production origin.

Required public configuration:

| Variable | Purpose | Current status |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin, sitemap, robots, JSON-LD | Set to the final domain before release |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL for account deletion | Required for the external deletion page |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key for account deletion | Required for the external deletion page; never use service role key |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Verified monitored support/privacy contact | Not supplied; launch blocker |
| `NEXT_PUBLIC_LEGAL_ENTITY` | Legal operator name | Not supplied; launch blocker |
| `NEXT_PUBLIC_GOVERNING_LAW` | Governing jurisdiction for terms | Not supplied; legal review required |
| `NEXT_PUBLIC_IOS_APP_URL` | Verified App Store listing | Not available yet; leave unset until live |
| `NEXT_PUBLIC_ANDROID_APP_URL` | Verified Google Play listing | Not available yet; leave unset until live |

The website deliberately does not render mail links or app-download links while their values are absent. Only the account deletion page uses the Supabase URL and anon key in the browser; no service role key or direct database connection is used by the website.

## Before public launch

- Add `https://tryskindecode.online/delete-account` to the Supabase Auth redirect URL allowlist, set the two Supabase public variables in Vercel, then verify the external deletion flow end-to-end using a disposable test account.
- Supply and verify a monitored support/privacy contact, legal operator identity/address, governing jurisdiction, and any required regional disclosures. Have the policy and terms reviewed for launch markets.
- Confirm that Open-Meteo’s current non-commercial free API terms allow SkinDecode’s intended use; Open-Meteo says the free API is limited to non-commercial purposes.
- Add only real App Store and Play Store listing URLs after those listings are available.
- Review mobile data practices and SDK inventory again for the actual release build.

## Architecture notes

- Next.js App Router, TypeScript, Tailwind CSS v4, React Server Components by default.
- Marketing, FAQ, privacy, terms, support, contact, and account deletion content is statically rendered where possible.
- `src/lib/site.ts` centralizes origin and verified public contact/store configuration.
- `src/app/sitemap.ts`, `robots.ts`, per-page metadata, Open Graph/Twitter metadata, and Organization/SoftwareApplication/BreadcrumbList structured data provide technical SEO.
- Accessibility includes semantic HTML, keyboard-accessible links/disclosures, skip navigation, descriptive image alternatives, and reduced-motion support.
- The phone preview is an original illustrative composition, not represented as a captured app screenshot.

## Vercel domain setup

After the first import, open **Project Settings → Domains**, add the domain you own, and follow the DNS records Vercel provides at your registrar. Do not guess DNS values. Once Vercel verifies the domain, update `NEXT_PUBLIC_SITE_URL` to the preferred canonical host, redeploy, and check `/sitemap.xml`, `/robots.txt`, canonical links, and social previews on the production URL.
