import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Footer, Header } from '@/components/site';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false, follow: false } };

export default function NotFound(){return <><Header/><main id="main-content" className="not-found"><span className="not-found__code">404</span><h1>This page wandered off.</h1><p>Let’s help you find your way back to SkinDecode.</p><div className="hero-actions" style={{justifyContent:'center'}}><Link href="/" className="button button--dark"><ArrowLeft size={15}/> Home</Link><Link href="/features" className="button button--light">Explore features <ArrowRight size={15}/></Link></div></main><Footer/></>}
