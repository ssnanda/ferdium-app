import { action, observable } from 'mobx';

export interface UnifiedInboxAccount {
  index: number;
  email: string;
  count: number;
}

export interface UnifiedInboxItem {
  accountIndex: number;
  accountEmail: string;
  title: string;
  summary: string;
  author: string;
  date: number;
  link: string;
  /** Hex message id (usable as Gmail `th=`). */
  threadId: string;
  /** Gmail's decimal message id (from the feed), used to fetch the body. */
  messageId?: string;
  /** Time exactly as the source page shows it (Voice), when it can't be parsed. */
  rawTime?: string;
  authorEmail: string;
}

/** A count-only entry (e.g. Google Voice: Messages / Calls / Voicemail). */
export interface UnifiedInboxCategory {
  id: string;
  label: string;
  count: number;
  url: string;
}

export interface UnifiedInboxServiceData {
  accounts: UnifiedInboxAccount[];
  categories?: UnifiedInboxCategory[];
  items: UnifiedInboxItem[];
  /** Human-readable reasons a feed could not be read (shown in the view). */
  problems: string[];
  updatedAt: number;
}

export const state = observable({
  /** True while the Unified Mailbox is shown in place of a service. */
  isActive: false,
  isRefreshing: false,
  /** One-line result of the last row action (errors included). */
  notice: '',
  byService: {} as Record<string, UnifiedInboxServiceData>,
});

export const setServiceData = action(
  (serviceId: string, data: Omit<UnifiedInboxServiceData, 'updatedAt'>) => {
    state.byService[serviceId] = { ...data, updatedAt: Date.now() };
  },
);

export const setRefreshing = action((value: boolean) => {
  state.isRefreshing = value;
});

export const totalUnread = (): number =>
  Object.values(state.byService).reduce(
    (sum, d) => sum + d.accounts.reduce((s, a) => s + a.count, 0),
    0,
  );

export const setNotice = action((message: string) => {
  state.notice = message;
});

export const removeItem = action((serviceId: string, link: string) => {
  const data = state.byService[serviceId];
  if (!data) return;
  const before = data.items.length;
  data.items = data.items.filter(i => i.link !== link);
  if (data.items.length < before && data.accounts[0]) {
    data.accounts[0].count = Math.max(0, data.accounts[0].count - 1);
  }
});

export const setActive = action((value: boolean) => {
  state.isActive = value;
});
