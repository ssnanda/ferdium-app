import type Service from '../../models/Service';
import type { InboxRow } from './actions';
import { runInService } from './poller';

export interface Preview {
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  body: string;
  note?: string;
}

// Runs in the Gmail page. Fetches the message's "original" (raw MIME) and
// decodes it to plain text. Viewing the original does NOT mark the message
// read, unlike opening the conversation. No DOMParser/innerHTML on purpose:
// Gmail's Trusted Types policy rejects them.
const gmailPreviewScript = (row: InboxRow): string => String.raw`(async () => {
  const res = await fetch('/mail/u/' + ${JSON.stringify(row.accountIndex)} + '/?view=om&permmsgid=msg-f:' + ${JSON.stringify(row.messageId)}, { credentials: 'include', cache: 'no-store' });
  if (!res.ok) return null;
  let raw = Array.from(new Uint8Array(await res.arrayBuffer()), b => String.fromCharCode(b)).join('');
  const unhtml = h => h
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  if (/^\s*<(!doctype|html)/i.test(raw) && /<pre/i.test(raw)) raw = unhtml(raw.slice(raw.search(/<pre/i)));
  const parseHeaders = block => {
    const h = {};
    block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach(line => {
      const i = line.indexOf(':');
      if (i > 0) h[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
    });
    return h;
  };
  const split = text => {
    const m = /\r?\n\r?\n/.exec(text);
    return m ? [text.slice(0, m.index), text.slice(m.index + m[0].length)] : [text, ''];
  };
  const decodeBytes = (body, enc, charset) => {
    let bytes;
    if (/base64/i.test(enc)) {
      bytes = Uint8Array.from(atob(body.replace(/\s+/g, '')), c => c.charCodeAt(0));
    } else if (/quoted-printable/i.test(enc)) {
      const t = body.replace(/=\r?\n/g, '');
      const arr = [];
      for (let i = 0; i < t.length; i += 1) {
        if (t[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) {
          arr.push(parseInt(t.slice(i + 1, i + 3), 16));
          i += 2;
        } else arr.push(t.charCodeAt(i) & 255);
      }
      bytes = Uint8Array.from(arr);
    } else bytes = Uint8Array.from(body, c => c.charCodeAt(0) & 255);
    try { return new TextDecoder(charset || 'utf-8').decode(bytes); } catch { return new TextDecoder().decode(bytes); }
  };
  const words = s => (s || '').replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs, e, t) => {
    try { return e.toLowerCase() === 'b' ? decodeBytes(t, 'base64', cs) : decodeBytes(t.replace(/_/g, ' '), 'quoted-printable', cs); } catch { return t; }
  });
  const collect = (text, out) => {
    const [head, body] = split(text);
    const h = parseHeaders(head);
    const type = (h['content-type'] || 'text/plain').toLowerCase();
    if (type.startsWith('multipart/')) {
      const b = /boundary="?([^";]+)"?/i.exec(h['content-type'] || '');
      if (b) body.split('--' + b[1]).slice(1).forEach(part => {
        if (!part.startsWith('--')) collect(part.replace(/^\r?\n/, ''), out);
      });
      return;
    }
    if (/^text\/(plain|html)/.test(type) && !/attachment/i.test(h['content-disposition'] || '')) {
      const cs = (/charset="?([^";\s]+)/i.exec(h['content-type'] || '') || [])[1];
      out.push({ html: type.startsWith('text/html'), text: decodeBytes(body, h['content-transfer-encoding'] || '', cs) });
    }
  };
  const top = parseHeaders(split(raw)[0]);
  const parts = [];
  collect(raw, parts);
  const plain = parts.find(p => !p.html);
  const html = parts.find(p => p.html);
  const body = (plain ? plain.text : html ? unhtml(html.text) : '')
    .replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
  return { from: words(top.from), to: words(top.to), subject: words(top.subject), date: top.date, body };
})()`;

/** Loads the text to preview for a row. Never marks anything read. */
export async function loadPreview(
  row: InboxRow,
  service: Service | undefined,
): Promise<Preview> {
  if (row.recipeId === 'google-voice') {
    return {
      from: row.author,
      body: row.summary || '(no text)',
      note: 'Voice only shows the text from its list; opening the conversation would mark it read.',
    };
  }
  if (row.recipeId === 'gmail' && row.messageId) {
    try {
      const result = await runInService<Preview | null>(
        service,
        gmailPreviewScript(row),
      );
      if (result?.body) return result;
    } catch {
      // fall through to the snippet
    }
  }
  return {
    from: row.author,
    subject: row.title,
    body: row.summary,
    note: 'Full text unavailable; showing the snippet.',
  };
}

export { gmailPreviewScript };
