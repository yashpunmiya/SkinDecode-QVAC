import type { Metadata } from 'next';
import { Breadcrumb, ContactState, Footer, Header } from '@/components/site';
import { metadataForPage, pageMetadata, siteConfig } from '@/lib/site';

export const metadata: Metadata = metadataForPage('/contact', pageMetadata.contact.title, pageMetadata.contact.description);

export default function ContactPage(){return <><Header/><main id="main-content"><div className="page-hero"><Breadcrumb items={[{name:'Home',href:'/'},{name:'Contact'}]}/><span className="eyebrow">Contact</span><h1>We’d like to hear from you.</h1><p>For product, privacy, or partnership questions, use the verified contact channel below when one is configured.</p><ContactState context="contact"/></div><section className="section section--compact"><div className="section__inner"><div className="copy-block"><h2>Website configuration</h2><p>Public email: {siteConfig.supportEmail || 'Not configured.'}</p><p style={{marginTop:8}}>Legal operator: {siteConfig.legalEntity || 'Not configured.'}</p><p style={{marginTop:8}}>These fields are intentionally left empty until the SkinDecode operator provides verified details.</p></div></div></section></main><Footer/></>}
