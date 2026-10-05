import type Service from '../../models/Service';
import { refreshService, runInService } from './poller';
import { type UnifiedInboxItem, removeItem, setNotice, state } from './store';

export type InboxRow = UnifiedInboxItem & {
  serviceId: string;
  serviceName: string;
  recipeId: string;
  color: string;
};

export interface InboxActionContext {
  service: Service | undefined;
  /** Switch the sidebar to the row's service. */
  activateService: (serviceId: string) => void;
  /** Leave the Unified Inbox view. */
  close: () => void;
}

export interface InboxAction {
  id: string;
  label: string;
  /** Primary action: also runs when the row itself is clicked. */
  primary?: boolean;
  /** When set, the row shows a text box and passes its text to `run`. */
  input?: { placeholder: string; submitLabel: string };
  run: (
    row: InboxRow,
    ctx: InboxActionContext,
    text?: string,
  ) => void | Promise<void>;
}

const gmailMarkReadScript = (row: InboxRow): string => `(async () => {
  const account = ${JSON.stringify(row.accountIndex)};
  if (!location.pathname.startsWith('/mail/u/' + account + '/')) {
    return 'this service is showing a different Google account; open it once first';
  }
  const previous = location.hash || '#inbox';
  location.hash = '#all/' + ${JSON.stringify(row.threadId)};
  await new Promise(resolve => setTimeout(resolve, 3000));
  location.hash = previous;
  return 'ok';
})()`;

const voiceMarkReadScript = (row: InboxRow): string => `(async () => {
  const text = (node, selector) =>
    (node.querySelector(selector)?.textContent || '').trim();
  const item = Array.from(document.querySelectorAll('gv-thread-list-item')).find(
    node =>
      text(node, 'gv-annotation.participants') === ${JSON.stringify(row.author)} &&
      text(node, 'gv-annotation.preview') === ${JSON.stringify(row.summary)},
  );
  if (!item) return 'open the Messages list in this service first';
  (item.querySelector('.container') || item).click();
  await new Promise(resolve => setTimeout(resolve, 2500));
  history.back();
  await new Promise(resolve => setTimeout(resolve, 1500));
  return 'ok';
})()`;

// To add an action (archive, delete, ...): append an entry here. The view
// renders every entry as a button on each row; nothing else to wire.
export const INBOX_ACTIONS: InboxAction[] = [
  {
    id: 'open',
    label: 'Open',
    primary: true,
    run: (row, ctx) => {
      ctx.activateService(row.serviceId);
      // The Atom link redirects to the thread inside the right account.
      if (row.link) ctx.service?.webview?.loadURL(row.link);
      ctx.close();
    },
  },
  {
    id: 'reply',
    label: 'Reply',
    input: { placeholder: 'Write a reply…', submitLabel: 'Open draft' },
    // Gmail has no send endpoint usable from here: this opens a compose window
    // in the service, prefilled, ready for you to press Send.
    run: (row, ctx, text = '') => {
      const url =
        `https://mail.google.com/mail/u/${row.accountIndex}/?view=cm&fs=1` +
        `&to=${encodeURIComponent(row.authorEmail)}` +
        `&su=${encodeURIComponent(`Re: ${row.title}`)}` +
        `&body=${encodeURIComponent(text)}`;
      ctx.activateService(row.serviceId);
      ctx.service?.webview?.loadURL(url);
      ctx.close();
    },
  },
  {
    id: 'markRead',
    label: 'Mark read',
    // Gmail/Voice mark a conversation read when it is opened, and there is no
    // endpoint we can call for that. So the service page itself opens the
    // conversation briefly, then goes back to where it was. The result is
    // verified by re-reading the unread list.
    run: async (row, ctx) => {
      setNotice(`Marking "${row.title}" as read…`);
      try {
        const outcome = await runInService<string>(
          ctx.service,
          row.recipeId === 'google-voice'
            ? voiceMarkReadScript(row)
            : gmailMarkReadScript(row),
        );
        if (outcome !== 'ok') {
          setNotice(`Mark read: ${outcome}`);
          return;
        }
        removeItem(row.serviceId, row.link);
        if (ctx.service) await refreshService(ctx.service);
        const stillUnread =
          state.byService[row.serviceId]?.items.some(
            i => i.link === row.link && i.threadId === row.threadId,
          ) ?? true;
        setNotice(
          stillUnread
            ? 'Mark read did not take effect. Use Open instead.'
            : 'Marked as read.',
        );
      } catch (error) {
        setNotice(`Mark read failed: ${String(error).slice(0, 100)}`);
      }
    },
  },
];
