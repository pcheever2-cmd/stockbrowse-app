/**
 * Free-tier view meter: 10 distinct entries per day (soft, NYT-style).
 * Client-side by necessity — auth is Bearer/localStorage (no cookies), so
 * static pages can't be gated server-side. Plus/Pro exempt (unlimited views
 * is a PLUS feature; Newsletter is "everything in Free" and stays metered).
 * Crawlers render each page statelessly (count=1), so SEO is unaffected.
 *
 * An "entry" is usually a stock symbol; the compare page passes one
 * `CMP:A:B` entry per pair so a comparison costs ONE view, not two.
 */
import { loadSession } from './subscription';

const VIEW_LIMIT = 10;
const METER_KEY = 'viewMeter';

function showViewWall(isLoggedIn: boolean) {
  if (document.getElementById('viewWall')) return;
  const wall = document.createElement('div');
  wall.id = 'viewWall';
  wall.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-[#080A0F]/80 backdrop-blur-md px-4';
  const signupCta = isLoggedIn
    ? ''
    : `<a href="/signup" class="block w-full bg-[#22D3EE] hover:bg-[#06B6D4] text-[#080A0F] font-semibold px-6 py-3 rounded-lg transition mb-3">Create a free account</a>`;
  wall.innerHTML = `
    <div class="bg-[#161B24] border border-[rgba(255,255,255,0.1)] rounded-2xl max-w-md w-full p-8 text-center">
      <div class="text-4xl mb-3">📊</div>
      <h2 class="text-xl font-bold text-slate-100 mb-2">You've used your 10 free stock views today</h2>
      <p class="text-sm text-[#CBD5E1] mb-6">Your views reset tomorrow — or go unlimited with Plus.</p>
      ${signupCta}
      <a href="/pricing" class="block w-full ${isLoggedIn ? 'bg-[#22D3EE] hover:bg-[#06B6D4] text-[#080A0F]' : 'bg-[#0C0F14] hover:bg-[#1a2030] text-slate-100 border border-[rgba(255,255,255,0.1)]'} font-semibold px-6 py-3 rounded-lg transition mb-4">Upgrade for unlimited views</a>
      ${isLoggedIn ? '' : '<p class="text-xs text-[#64748B] mb-4">Free accounts keep the same daily limit — Plus removes it.</p>'}
      <a href="/" class="text-sm text-[#64748B] hover:text-[#CBD5E1] transition">← Back to browsing</a>
    </div>`;
  document.body.appendChild(wall);
  document.body.style.overflow = 'hidden';
}

/** Count `entry` against today's meter; shows the wall (and returns false) at the limit. */
export async function applyViewMeter(entry: string): Promise<boolean> {
  try {
    const user = await loadSession();
    if (user && (user.tier === 'plus' || user.tier === 'pro')) return true; // unlimited

    if (!entry) return true;
    const today = new Date().toISOString().slice(0, 10);
    let meter: { date: string; symbols: string[] } | null = null;
    try { meter = JSON.parse(localStorage.getItem(METER_KEY) || 'null'); } catch { meter = null; }
    if (!meter || meter.date !== today || !Array.isArray(meter.symbols)) {
      meter = { date: today, symbols: [] };
    }

    if (!meter.symbols.includes(entry)) {
      if (meter.symbols.length >= VIEW_LIMIT) {
        showViewWall(!!user);
        return false; // not recorded — the wall blocks this view
      }
      meter.symbols.push(entry);
    }
    localStorage.setItem(METER_KEY, JSON.stringify(meter));
    return true;
  } catch {
    return true; // metering must never break the page
  }
}
