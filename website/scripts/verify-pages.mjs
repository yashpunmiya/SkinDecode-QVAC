const base = process.env.SITE_URL || 'http://localhost:3000';
const pages = ['/', '/features', '/about', '/faq', '/privacy', '/terms', '/support', '/contact', '/delete-account'];
const seenTitles = new Set();
const failures = [];

for (const path of pages) {
  const response = await fetch(new URL(path, base));
  const html = await response.text();
  const title = html.match(/<title>(.*?)<\/title>/)?.[1] || '';
  const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1] || '';
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] || '';
  const socialTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || '';

  if (response.status !== 200) failures.push(`${path}: expected 200, got ${response.status}`);
  if (!title) failures.push(`${path}: missing title`);
  if (seenTitles.has(title)) failures.push(`${path}: duplicate title "${title}"`);
  seenTitles.add(title);
  if (!description) failures.push(`${path}: missing description`);
  if (!canonical) failures.push(`${path}: missing canonical URL`);
  if (!socialTitle) failures.push(`${path}: missing Open Graph title`);
  console.log(`${response.status} ${path} · ${title || '(missing title)'}`);
}

for (const path of ['/robots.txt', '/sitemap.xml']) {
  const response = await fetch(new URL(path, base));
  if (response.status !== 200) failures.push(`${path}: expected 200, got ${response.status}`);
  console.log(`${response.status} ${path}`);
}

const missing = await fetch(new URL('/route-that-does-not-exist', base));
if (missing.status !== 404) failures.push(`unknown route: expected 404, got ${missing.status}`);
console.log(`${missing.status} /route-that-does-not-exist`);

if (failures.length) {
  console.error('\nPage verification failed:\n- ' + failures.join('\n- '));
  process.exitCode = 1;
} else {
  console.log('\nVerified route status, unique titles, descriptions, canonical URLs, and Open Graph titles.');
}
