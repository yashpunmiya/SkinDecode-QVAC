import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, ArrowUpRight, Droplets, Leaf, ShieldCheck, Sun } from 'lucide-react';
import { DownloadBadges, FeatureIcon, Footer, Header, PhonePreview, SectionHeading } from '@/components/site';

export default function HomePage() {
  return <><Header /><main id="main-content">
    <section className="home-hero">
      <div className="hero-copy">
        <span className="eyebrow">A calmer way to care for your skin</span>
        <h1 className="reveal">Understand your skin. <em>Simplify</em> your skincare.</h1>
        <p className="reveal reveal--delay">A little more clarity for the products you choose and the routines you keep. Made to feel personal, useful, and easy to return to.</p>
        <div className="hero-actions reveal reveal--delay2"><Link className="button button--dark" href="/features">Explore SkinDecode <ArrowRight size={16}/></Link><Link className="button button--text" href="/about">Our approach <ArrowUpRight size={15}/></Link></div>
        <div style={{marginTop:22}}><DownloadBadges/></div>
        <p className="hero-copy__fine">The app is in development. Store links will appear when listings are available.</p>
      </div>
      <div className="home-hero__visual"><div className="hero-orbit"/><PhonePreview/></div>
    </section>

    <section className="trust-strip" aria-label="SkinDecode principles"><div className="trust-strip__inner">
      <div className="trust-item"><ShieldCheck/><span>Clear about what’s known</span></div><div className="trust-item"><Leaf/><span>Personal context, not one-size-fits-all</span></div><div className="trust-item"><Droplets/><span>Small steps, steady routines</span></div><div className="trust-item"><Sun/><span>Your data, explained plainly</span></div>
    </div></section>

    <section className="section"><div className="section__inner"><SectionHeading eyebrow="A few thoughtful steps" title="Skincare, with a little more context." align="center">Start with what matters to you. Then make sense of products and habits one decision at a time.</SectionHeading>
      <div className="process-grid">
        {[['01','Create your skin profile','Share your skin type, sensitivity, concerns, goals, and preferences.'],['02','Understand a formula','Look through product details, ingredient lists, and available formula evidence.'],['03','Make a routine your own','Plan simple AM and PM steps and link products from your shelf.'],['04','Notice changes over time','Keep a private daily check-in and compare yesterday with today.']].map(([n,title,body],i)=><article className="process-card" key={n}><span className="process-card__number">{n}</span><FeatureIcon kind={(['privacy','formula','routine','check'] as const)[i]}/><h3>{title}</h3><p>{body}</p></article>)}
      </div>
    </div></section>

    <section className="section section--sage"><div className="section__inner feature-story">
      <div className="feature-story__copy"><span className="eyebrow">Product intelligence</span><h2>Look beyond the front label.</h2><p>Explore available ingredient lists and formula-level benefits or concerns. Skin Match brings that evidence together with your skin profile, with confidence that reflects how much information is available.</p><p>It’s an informational guide to help you ask better questions—not a diagnosis or a promise about how a product will work for you.</p><Link className="button button--light" href="/features#product-intelligence">How product insights work <ArrowRight size={15}/></Link></div>
      <div className="story-visual"><Image src="/brand/understand.png" alt="Soft botanical ingredient-inspired artwork" fill sizes="(max-width: 700px) 90vw, 42vw"/><div className="story-visual__veil"/><span className="story-visual__label">Understand the formula</span><b>More context for the products you choose.</b></div>
    </div></section>

    <section className="section"><div className="section__inner"><SectionHeading eyebrow="Build a rhythm" title="A routine that fits real life." >Plan morning and evening steps, check them off as you go, and keep your own product shelf close at hand.</SectionHeading>
      <div className="feature-row">
        <article className="feature-tile"><FeatureIcon kind="routine"/><h3>My Routine</h3><p>Organize AM and PM steps, choose when to use them, track check-ins, and connect a step with a product from your shelf.</p></article>
        <article className="feature-tile"><FeatureIcon kind="shelf"/><h3>My Shelf</h3><p>Save catalog products to a personal shelf without copying product details into your account.</p></article>
        <article className="feature-tile"><FeatureIcon kind="check"/><h3>Daily Skin Check</h3><p>Compare today with yesterday, record a few skin observations, and optionally keep a private progress photo on your device.</p></article>
      </div>
    </div></section>

    <section className="section section--cream"><div className="section__inner feature-story feature-story--reverse">
      <div className="feature-story__copy"><span className="eyebrow">Your everyday companion</span><h2>Keep the useful things close.</h2><p>Make space for the parts of skincare that help you stay consistent: a manageable routine, a record of what you notice, and reminders you can adjust to your day.</p><p>Daily skin check-ins and water tracking are stored on your device. Routine backups sync to your signed-in account so they can be restored.</p><Link className="button button--light" href="/privacy">Read how your data works <ArrowRight size={15}/></Link></div>
      <div className="story-visual"><Image src="/brand/personalized.png" alt="Soft botanical artwork representing a personal skincare journey" fill sizes="(max-width: 700px) 90vw, 42vw"/><div className="story-visual__veil"/><span className="story-visual__label">Personal, at your pace</span><b>A good routine leaves room to be human.</b></div>
    </div></section>

    <section className="section section--compact"><div className="section__inner"><SectionHeading eyebrow="Made to be thoughtful" title="Clarity without the noise." align="center"/>
      <div className="feature-row">
        <article className="feature-tile"><FeatureIcon kind="uv"/><h3>Current UV context</h3><p>If you choose to share device location, the app can request current weather and UV conditions from Open-Meteo.</p></article>
        <article className="feature-tile"><FeatureIcon kind="privacy"/><h3>Local-first tracking</h3><p>Water intake, Daily Skin Check history, progress photos, reminders, and chat history stay on your device.</p></article>
        <article className="feature-tile"><FeatureIcon kind="formula"/><h3>Skin AI is in preview</h3><p>The current Skin AI screen uses a local placeholder response. No AI provider is connected yet.</p><span className="feature-tile__status"><i className="status-dot"/> Preview mode</span></article>
      </div>
    </div></section>

      <section className="section section--compact"><div className="section__inner home-cta"><div><span className="eyebrow">A little more understanding</span><h2>Make skincare feel simpler.</h2><p>SkinDecode is getting ready. App store links will be added when they’re live.</p></div><DownloadBadges/></div></section>
  </main><Footer/></>;
}
