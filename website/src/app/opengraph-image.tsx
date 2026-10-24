import { ImageResponse } from 'next/og';

export const alt = 'SkinDecode — Understand your skin. Simplify your skincare.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', background: '#fafaf7', display: 'flex', color: '#12231b', padding: '70px 82px', position: 'relative', overflow: 'hidden', fontFamily: 'Georgia, serif' }}>
      <div style={{ position: 'absolute', right: -120, top: -160, width: 570, height: 570, borderRadius: 285, background: '#eff2ea', display: 'flex' }} />
      <div style={{ position: 'absolute', right: 12, top: -30, width: 360, height: 360, borderRadius: 180, border: '1px solid #dce5d9', display: 'flex' }} />
      <div style={{ position: 'absolute', right: 55, top: 16, width: 275, height: 275, borderRadius: 138, border: '1px solid #dce5d9', display: 'flex' }} />
      <div style={{ position: 'absolute', right: 108, bottom: -190, width: 250, height: 410, borderRadius: 130, transform: 'rotate(36deg)', background: '#e5eee2', display: 'flex' }} />
      <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#1e4e38', fontFamily: 'Georgia, serif', fontSize: 25, fontWeight: 600, marginBottom: 74 }}>
          <div style={{ width: 34, height: 34, borderRadius: 12, background: '#e7efe4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 11, height: 17, background: '#1e4e38', borderRadius: '12px 0 12px 0', transform: 'rotate(45deg)' }} /></div>
          SkinDecode
        </div>
        <div style={{ fontSize: 70, lineHeight: 1.05, letterSpacing: -3, maxWidth: 810 }}>Understand your skin.</div>
        <div style={{ fontSize: 70, lineHeight: 1.05, letterSpacing: -3, fontStyle: 'italic', color: '#1e4e38', maxWidth: 900 }}>Simplify your skincare.</div>
        <div style={{ marginTop: 28, fontFamily: 'Arial, sans-serif', fontSize: 22, color: '#637168' }}>A little more clarity for the products you choose and the routines you keep.</div>
        <div style={{ marginTop: 50, display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'Arial, sans-serif', fontSize: 14, letterSpacing: 2, color: '#65806f' }}>A CALMER WAY TO CARE FOR YOUR SKIN</div>
      </div>
    </div>,
    { ...size },
  );
}
