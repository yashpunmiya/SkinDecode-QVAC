import Link from 'next/link';
import Image from 'next/image';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, Droplets, FlaskConical, Leaf, Menu, ScanFace, ShieldCheck, Sun } from 'lucide-react';
import { siteConfig, navItems, legalLinks } from '@/lib/site';

export function Logo({ footer = false }: { footer?: boolean }) {
  return (
    <Link aria-label="SkinDecode home" className={`brand${footer ? ' brand--footer' : ''}`} href="/">
      <span className="brand__mark" aria-hidden="true"><Leaf size={18} strokeWidth={1.7}/></span><span className="brand__name">SkinDecode</span>
    </Link>
  );
}

export function Header() {
  return (
    <header className="header">
      <div className="header__inner">
        <Logo />
        <nav className="nav" aria-label="Main navigation">
          {navItems.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
        </nav>
        <Link className="header__cta" href="/features">Get to know the app <ArrowUpRight size={15} /></Link>
        <details className="mobile-menu">
          <summary aria-label="Open navigation"><Menu size={21} /></summary>
          <div className="mobile-menu__panel">
            <div className="mobile-menu__top"><Logo /></div>
            {navItems.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
            <Link className="button button--dark" href="/features">Explore SkinDecode <ArrowRight size={16} /></Link>
          </div>
        </details>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer__top">
        <div className="footer__brand">
          <Logo footer />
          <p>A little more clarity for your everyday skincare.</p>
        </div>
        <div className="footer__links">
          <div><span className="eyebrow">Explore</span><Link href="/features">Features</Link><Link href="/about">Our approach</Link><Link href="/faq">FAQ</Link></div>
          <div><span className="eyebrow">Good to know</span>{legalLinks.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}<Link href="/contact">Contact</Link></div>
        </div>
        <div className="footer__availability"><span className="status-dot" /> App links coming soon</div>
      </div>
      <div className="footer__bottom"><span>© {new Date().getFullYear()} SkinDecode</span><span>Skincare information for everyday use. Not medical advice.</span></div>
    </footer>
  );
}

export function PageShell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <><Header /><main className={className}>{children}</main><Footer /></>;
}

export function SectionHeading({ eyebrow, title, children, align = 'left' }: { eyebrow: string; title: string; children?: React.ReactNode; align?: 'left' | 'center' }) {
  return <div className={`section-heading section-heading--${align}`}><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{children && <p>{children}</p>}</div>;
}

export function DownloadBadges() {
  return (
    <div className="download-row" aria-label="App store availability">
      {siteConfig.iosUrl ? <a className="store-badge" href={siteConfig.iosUrl} target="_blank" rel="noreferrer"><span className="store-badge__mark">A</span><span><small>Download on the</small><b>App Store</b></span></a> : <span className="store-badge store-badge--soon"><span className="store-badge__mark">A</span><span><small>iOS app</small><b>Coming soon</b></span></span>}
      {siteConfig.androidUrl ? <a className="store-badge" href={siteConfig.androidUrl} target="_blank" rel="noreferrer"><span className="store-badge__mark store-badge__mark--play">▶</span><span><small>Get it on</small><b>Google Play</b></span></a> : <span className="store-badge store-badge--soon"><span className="store-badge__mark store-badge__mark--play">▶</span><span><small>Android app</small><b>Coming soon</b></span></span>}
    </div>
  );
}

export function PhonePreview() {
  return (
    <div className="phone-scene" aria-label="Illustrative SkinDecode app screens">
      <div className="phone phone--back">
        <div className="phone__notch" />
        <div className="phone__inside">
          <div className="phone__mini-top"><i /> <span>SkinDecode</span> <i /></div>
          <span className="eyebrow">YOUR ROUTINE</span>
          <h3>A little care, every day.</h3>
          <div className="mini-routine"><div className="mini-routine__sun"><Sun size={16} /></div><div><b>Morning</b><small>3 steps · ready when you are</small></div><ArrowRight size={14} /></div>
          <div className="mini-routine"><div className="mini-routine__moon">◒</div><div><b>Evening</b><small>2 steps · take it slow</small></div><ArrowRight size={14} /></div>
          <div className="week-dots"><i/><i/><i/><i/><i/><i/><i/></div>
        </div>
      </div>
      <div className="phone phone--front">
        <div className="phone__notch" />
        <div className="phone__inside">
          <div className="phone__mini-top"><i /> <span>For your skin</span> <i /></div>
          <div className="phone-greeting"><span className="eyebrow">YOUR SKIN, YOUR CONTEXT</span><h3>Understand the formula.</h3><p>Product insights, grounded in what’s known.</p></div>
          <div className="product-mini"><Image src="/brand/understand.jpg" alt="Abstract skincare ingredient visual" width={86} height={78} /><div><small>PRODUCT DETAILS</small><b>Ingredient insights</b><span>Formula · skin profile</span></div></div>
          <div className="match-card"><div><span>SKIN MATCH</span><b>For your profile</b></div><div className="match-orbit"><span>•</span></div></div>
          <div className="phone-caption">Built around your skin profile</div>
        </div>
      </div>
      <div className="floating-note floating-note--left"><span className="floating-note__icon"><Leaf size={15}/></span><span><b>Consider the whole formula</b><small>Context matters</small></span></div>
      <div className="floating-note floating-note--right"><span className="floating-note__icon floating-note__icon--cream"><ShieldCheck size={15}/></span><span><b>Your pace, your routine</b><small>Made to feel manageable</small></span></div>
      <div className="phone-scene__leaf" aria-hidden="true"><Leaf size={30}/></div>
    </div>
  );
}

export function FeatureIcon({ kind }: { kind: 'formula' | 'routine' | 'check' | 'shelf' | 'uv' | 'privacy' }) {
  const Icon = { formula: FlaskConical, routine: Leaf, check: ScanFace, shelf: Droplets, uv: Sun, privacy: ShieldCheck }[kind];
  return <span className="feature-icon"><Icon size={20} strokeWidth={1.6}/></span>;
}

export function FAQList({ items }: { items: { question: string; answer: React.ReactNode }[] }) {
  return <div className="faq-list">{items.map((item) => <details className="faq-item" key={item.question}><summary>{item.question}<ChevronDown size={18}/></summary><div className="faq-item__answer">{item.answer}</div></details>)}</div>;
}

export function ContactState({ context = 'support' }: { context?: 'support' | 'contact' }) {
  if (siteConfig.supportEmail) return <a className="button button--dark" href={`mailto:${siteConfig.supportEmail}`}>Email SkinDecode <ArrowRight size={16}/></a>;
  return <div className="notice notice--warm"><span className="notice__icon"><ArrowDown size={17}/></span><div><b>{context === 'contact' ? 'Public contact is not configured yet.' : 'Support contact is not configured yet.'}</b><p>A verified, monitored email address must be added in the website configuration before this page can accept requests. No messages are currently sent or collected here.</p></div></div>;
}

export function CheckLine({ children }: { children: React.ReactNode }) {
  return <li className="check-line"><span><Check size={14}/></span>{children}</li>;
}

export function Breadcrumb({ items }: { items: { name: string; href?: string }[] }) {
  const jsonLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, ...(item.href ? { item: `${siteConfig.origin}${item.href}` } : {}) })) };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}/><nav aria-label="Breadcrumb" className="breadcrumb">{items.map((item, index) => <span key={item.name}>{index > 0 && <i> / </i>}{item.href && index < items.length - 1 ? <Link href={item.href}>{item.name}</Link> : item.name}</span>)}</nav></>;
}

export function StoryVisual({ image, label, title }: { image: string; label: string; title: string }) {
  return <div className="story-visual"><Image src={image} alt="" fill sizes="(max-width: 700px) 90vw, 42vw"/><div className="story-visual__veil"/><span className="story-visual__label">{label}</span><b>{title}</b></div>;
}
