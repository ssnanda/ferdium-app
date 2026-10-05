import type Service from '../../models/Service';
import { setRefreshing, setServiceData, state } from './store';

const REFRESH_MS = 60_000;
/** While the Unified Mailbox is open the lists are refreshed this often. */
const ACTIVE_REFRESH_MS = 15_000;
const STALE_MS = 10 * 60_000;
const FIRST_DELAY_MS = 8000;

// Runs inside the Gmail page (main world, so the page's cookies and origin
// apply). Reads the unread Atom feed of every signed-in Google account.
const GMAIL_SCRIPT = `(async () => {
  // Gmail enforces Trusted Types, which blocks DOMParser.parseFromString().
  // The Atom payload is small and regular, so parse only the fields we need.
  const decode = value => value
    .replace(/<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const values = (source, tag) => Array.from(
    source.matchAll(new RegExp('<(?:\\\\w+:)?' + tag + '(?:\\\\s[^>]*)?>([\\\\s\\\\S]*?)</(?:\\\\w+:)?' + tag + '>', 'gi')),
    match => decode(match[1].trim()),
  );
  const value = (source, tag) => values(source, tag)[0] || '';
  const out = { accounts: [], items: [], problems: [] };
  const seen = new Set();
  for (let i = 0; i < 10; i += 1) {
    let body = '';
    let status = 0;
    try {
      const res = await fetch('/mail/u/' + i + '/feed/atom', {
        credentials: 'include',
        cache: 'no-store',
      });
      status = res.status;
      body = await res.text();
    } catch (e) {
      out.problems.push('account ' + i + ': ' + e);
      break;
    }
    if (!/<(?:\\w+:)?feed(?:\\s|>)/i.test(body)) {
      if (i === 0) out.problems.push('account 0: HTTP ' + status + ' ' + body.slice(0, 60).replace(/\\s+/g, ' '));
      break;
    }
    const email = (/for\\s+(\\S+@\\S+)/.exec(value(body, 'title')) || [])[1] || 'Account ' + i;
    // Gmail answers a non-existent account index with the first account's feed
    // again, so a repeated address means we have run past the last account.
    if (out.accounts.some(account => account.email === email)) break;
    out.accounts.push({ index: i, email, count: parseInt(value(body, 'fullcount'), 10) || 0 });
    for (const entry of values(body, 'entry')) {
      const author = value(entry, 'author') || entry;
      const link = (/<(?:\\w+:)?link\\b[^>]*\\bhref=["']([^"']+)["']/i.exec(entry) || [])[1] || '';
      const key = email + '|' + (link || value(entry, 'id'));
      if (seen.has(key)) continue;
      seen.add(key);
      out.items.push({
        accountIndex: i,
        accountEmail: email,
        title: value(entry, 'title') || '(no subject)',
        summary: value(entry, 'summary'),
        author: value(author, 'name'),
        date: new Date(value(entry, 'modified') || value(entry, 'issued')).getTime(),
        link: decode(link),
        threadId: (() => {
          try {
            return BigInt(value(entry, 'id').split(':').pop()).toString(16);
          } catch {
            return '';
          }
        })(),
        messageId: value(entry, 'id').split(':').pop(),
        authorEmail: value(author, 'email'),
      });
    }
  }
  return out;
})()`;

// Google Voice has no feed, so read its rendered unread conversations and the
// calls/voicemail sidebar badges.
const VOICE_SCRIPT = `(() => {
  const n = sel =>
    parseInt((document.querySelector(sel)?.textContent || '').replace(/[^0-9]/g, ''), 10) || 0;
  const u = (/\\/u\\/(\\d+)/.exec(location.pathname) || [])[1] || '0';
  const base = location.origin + '/u/' + u + '/';
  const defs = [
    ['messages', 'Messages', 'a[gv-test-id="sidenav-messages"] span.navItemBadge'],
    ['calls', 'Calls', 'a[gv-test-id="sidenav-calls"] span.navItemBadge'],
    ['voicemail', 'Voicemail', 'a[gv-test-id="sidenav-voicemail"] span.navItemBadge'],
  ];
  const badgeCounts = Object.fromEntries(defs.map(([id, , sel]) => [id, n(sel)]));
  const conversationItems = Array.from(document.querySelectorAll('gv-thread-list-item'));
  const unreadItems = conversationItems.filter(item => {
    const clickable = item.querySelector('.container');
    return clickable && !clickable.classList.contains('read');
  });
  // Voice shows "3:45 PM" (today), "Yesterday", "Mon", "Oct 3" or "10/3/26".
  const parseVoiceTime = text => {
    const now = new Date();
    const clock = /^(\\d{1,2}):(\\d{2})\\s*([AP]M)$/i.exec(text);
    if (clock) {
      const d = new Date(now);
      d.setHours((Number(clock[1]) % 12) + (/pm/i.test(clock[3]) ? 12 : 0), Number(clock[2]), 0, 0);
      return d.getTime();
    }
    if (/^yesterday/i.test(text)) {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      d.setHours(12, 0, 0, 0);
      return d.getTime();
    }
    const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(text.slice(0, 3).toLowerCase());
    if (day >= 0 && /^[a-z]+$/i.test(text)) {
      const d = new Date(now);
      d.setDate(d.getDate() - (((now.getDay() - day + 7) % 7) || 7));
      d.setHours(12, 0, 0, 0);
      return d.getTime();
    }
    // "Oct 3": Chromium would default the year to 2001, so add it ourselves.
    let parsed = NaN;
    if (/^[a-z]{3,9}\\.?\\s+\\d{1,2}$/i.test(text)) {
      parsed = Date.parse(text + ' ' + now.getFullYear());
      if (parsed > now.getTime()) parsed = Date.parse(text + ' ' + (now.getFullYear() - 1));
    } else if (/^\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}$/.test(text)) {
      parsed = Date.parse(text);
    }
    return parsed;
  };
  const items = unreadItems.map((item, index) => {
    const value = selector => (item.querySelector(selector)?.textContent || '').trim();
    const timestamp = value('.timestamp');
    const parsedDate = parseVoiceTime(timestamp);
    return {
      accountIndex: 0,
      accountEmail: 'Google Voice',
      title: value('gv-annotation.participants') || 'Google Voice message',
      summary: value('gv-annotation.preview'),
      author: value('gv-annotation.participants') || 'Unknown caller',
      date: Number.isNaN(parsedDate) ? Date.now() - index : parsedDate,
      rawTime: timestamp,
      link: base + 'messages',
      threadId: 'voice-' + index,
      authorEmail: '',
    };
  });
  const messageCount = Math.max(badgeCounts.messages, unreadItems.length);
  const categories = defs
    .filter(([id]) => id !== 'messages' || items.length === 0)
    .map(([id, label]) => ({ id, label, count: badgeCounts[id], url: base + id }))
    .filter(category => category.count > 0);
  const total = messageCount + badgeCounts.calls + badgeCounts.voicemail;
  const found = defs.some(([, , sel]) => document.querySelector(sel)) || conversationItems.length > 0;
  return {
    accounts: [{ index: 0, email: 'Google Voice', count: total }],
    items,
    categories,
    problems: found ? [] : ['sidebar not found (not signed in, or Voice changed its layout)'],
  };
})()`;

/** Recipe id -> script that runs in the service page and returns its data. */
export const SOURCES: Record<string, string> = {
  gmail: GMAIL_SCRIPT,
  'google-voice': VOICE_SCRIPT,
};

/** Run a script in a service's page (its own cookies/origin apply). */
export async function runInService<T>(
  service: Service | undefined,
  script: string,
): Promise<T> {
  if (!service?.webview) throw new Error('service not loaded');
  return service.webview.executeJavaScript(script);
}

/** Services that are children of the Unified Mailbox but only report the
 *  unread count Ferdium already tracks from their own badge (no message list). */
export const BADGE_ONLY = new Set(['zoho']);

export async function refreshService(service: Service): Promise<void> {
  if (BADGE_ONLY.has(service.recipe.id)) {
    if (!service.isEnabled) return;
    setServiceData(service.id, {
      accounts: [
        {
          index: 0,
          email: service.name,
          count: service.unreadDirectMessageCount,
        },
      ],
      items: [],
      problems: [],
    });
    return;
  }
  const { webview } = service;
  if (!webview || !service.isEnabled || !SOURCES[service.recipe.id]) return;
  try {
    const result = await webview.executeJavaScript(SOURCES[service.recipe.id]);
    setServiceData(service.id, result);
  } catch (error) {
    // Keep what we had for a while so a busy or reloading page doesn't blank
    // the list; after STALE_MS the old data is dropped (it may be read by now).
    const previous = state.byService[service.id];
    const fresh = previous && Date.now() - previous.updatedAt < STALE_MS;
    setServiceData(service.id, {
      accounts: fresh ? previous.accounts : [],
      items: fresh ? previous.items : [],
      categories: fresh ? previous.categories : [],
      problems: [`not ready: ${String(error).slice(0, 120)}`],
    });
  }
}

export async function refreshAll(getServices: () => Service[]): Promise<void> {
  setRefreshing(true);
  try {
    await Promise.all(getServices().map(service => refreshService(service)));
  } finally {
    setRefreshing(false);
  }
}

export function startPolling(getServices: () => Service[]): void {
  const run = () => {
    if (!state.isRefreshing) refreshAll(getServices);
  };
  let lastRun = 0;
  const tick = () => {
    const interval = state.isActive ? ACTIVE_REFRESH_MS : REFRESH_MS;
    if (Date.now() - lastRun >= interval - 1000) {
      lastRun = Date.now();
      run();
    }
  };
  setTimeout(() => {
    lastRun = Date.now();
    run();
  }, FIRST_DELAY_MS);
  setInterval(tick, ACTIVE_REFRESH_MS);
  // Coming back to the app is when stale "unread" is most noticeable.
  window.addEventListener('focus', () => {
    lastRun = Date.now();
    run();
  });
}
