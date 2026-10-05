import { noop } from 'lodash';
import { inject, observer } from 'mobx-react';
import { Component, Fragment, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { type WrappedComponentProps, injectIntl } from 'react-intl';
import withStyles, { type WithStylesProps } from 'react-jss';
import type { StoresProps } from '../../@types/ferdium-components.types';
import type Service from '../../models/Service';
import { INBOX_ACTIONS, type InboxRow } from './actions';
import { refreshAll } from './poller';
import { type Preview, loadPreview } from './preview';
import { setActive, setNotice, state } from './store';

/**
 * The panel renders inside a Shadow DOM so none of Ferdium's global CSS can
 * reach it (that is what kept squashing/stretching the layout). Every rule
 * here is scoped to the shadow root.
 */
const buildCss = (theme: any): string => `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .uib-panel {
    position: absolute; inset: 0; overflow: auto;
    padding: 0 24px 24px;
    background: ${theme.colorBackground};
    color: ${theme.colorText};
    font: 14px/20px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .uib-inner { min-width: 1080px; }
  .uib-header {
    position: sticky; top: 0; z-index: 3;
    margin: 0 -24px; padding: 16px 24px 0;
    background: ${theme.colorBackground};
  }
  .uib-headline { margin: 0 0 12px; font-size: 22px; font-weight: 300; line-height: 28px; }
  .uib-toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }
  .uib-chip {
    border: 0; border-radius: 14px; padding: 3px 10px; font: inherit; font-size: 12px;
    cursor: pointer; color: #fff; opacity: 0.55;
  }
  .uib-chipOn { opacity: 1; }
  .uib-refresh {
    margin-left: auto; border: 0; border-radius: 6px; padding: 4px 10px; font: inherit;
    cursor: pointer; background: ${theme.styleTypes.primary.accent};
    color: ${theme.styleTypes.primary.contrast};
  }
  .uib-notice { font-size: 12px; margin-bottom: 6px; }
  .uib-problem { color: #ea4335; }
  .uib-ok { color: #188038; }

  /* table: one shared grid for the header and every row */
  .uib-grid {
    display: grid; align-items: center; column-gap: 10px;
    grid-template-columns: 24px 214px 170px minmax(140px, 0.9fr) minmax(200px, 1.6fr) 150px 190px;
  }
  .uib-thead {
    padding: 6px 12px 6px 16px; font-size: 11px; font-weight: 600;
    letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.8;
    border-bottom: 1px solid ${theme.colorText}33;
  }
  .uib-row {
    min-height: 36px; padding: 4px 12px 4px 12px; border-left: 4px solid;
    border-bottom: 1px solid ${theme.colorText}14; cursor: default;
  }
  .uib-row:hover { background: ${theme.styleTypes.primary.accent}1f; }
  .uib-rowSelected { background: ${theme.styleTypes.primary.accent}2e; }
  .uib-cell { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .uib-strong { font-weight: 600; }
  .uib-dim { opacity: 0.75; font-size: 12px; }
  .uib-check { width: 16px; height: 16px; margin: 0; cursor: pointer; }
  .uib-btns { display: flex; gap: 4px; }
  .uib-action {
    border: 0; border-radius: 4px; padding: 2px 8px; font: inherit; font-size: 11px;
    cursor: pointer; background: ${theme.styleTypes.primary.accent};
    color: ${theme.styleTypes.primary.contrast};
  }
  .uib-action:disabled { opacity: 0.4; cursor: default; }
  .uib-bulk { font-size: 11px; text-transform: none; letter-spacing: 0; }
  .uib-clickable { cursor: pointer; }
  .uib-preview {
    margin: 0 0 6px; padding: 10px 16px 10px 50px; border-left: 4px solid;
    background: ${theme.colorText}0d; border-bottom: 1px solid ${theme.colorText}14;
  }
  .uib-previewMeta { font-size: 12px; line-height: 18px; margin-bottom: 8px; opacity: 0.9; }
  .uib-previewBody {
    white-space: pre-wrap; overflow-wrap: anywhere; max-height: 360px; overflow: auto;
    padding: 8px 10px; margin-bottom: 6px; border-radius: 4px;
    background: ${theme.colorBackground};
  }
  .uib-day {
    margin: 14px 0 4px; font-size: 12px; font-weight: 600; letter-spacing: 0.04em;
    text-transform: uppercase; opacity: 0.65;
  }
  .uib-reply { display: flex; gap: 6px; padding: 6px 12px 8px 54px; }
  .uib-replyInput { flex: 1; padding: 3px 6px; font: inherit; font-size: 12px; }
  .uib-empty { padding: 24px; text-align: center; opacity: 0.7; }
`;

/** `classes.foo` -> "uib-foo" (plain class names, styled by buildCss). */
const classes = new Proxy({} as Record<string, string>, {
  get: (_target, key) => `uib-${String(key)}`,
});

const COLORS = [
  '#1a73e8',
  '#ea4335',
  '#188038',
  '#e37400',
  '#9334e6',
  '#d01884',
];

const DAY_MS = 86_400_000;
const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "Today", "Yesterday", or "Mon, Oct 3" (with the year when it differs). */
const dayLabel = (ms: number): string => {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / DAY_MS);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const sameYear = new Date(ms).getFullYear() === new Date().getFullYear();
  return new Date(ms).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
};

/** Exact time of day, e.g. "4:31 AM"; Voice day-only stamps are shown as written. */
const clock = (row: { date: number; rawTime?: string }): string => {
  if (row.rawTime && !/\d{1,2}:\d{2}/.test(row.rawTime)) return row.rawTime;
  return new Date(row.date).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
};

const ago = (ms: number): string => {
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

const rowKeyOf = (row: InboxRow): string =>
  `${row.serviceId}-${row.accountIndex}-${row.threadId}-${row.link}`;

interface IProps
  extends WithStylesProps<() => Record<string, never>>,
    Partial<StoresProps>,
    WrappedComponentProps {}

interface IState {
  filter: string | null; // serviceId
  selected: string[]; // row keys ticked in the checkbox column
  replyKey: string | null; // row whose reply box is open
  replyText: string;
  openKey: string | null; // row whose preview is open
  previews: Record<string, Preview | 'loading'>;
  shadow: ShadowRoot | null;
}

@inject('stores', 'actions')
@observer
class UnifiedInboxView extends Component<IProps, IState> {
  constructor(props: IProps) {
    super(props);
    this.state = {
      filter: null,
      selected: [],
      replyKey: null,
      replyText: '',
      openKey: null,
      previews: {},
      shadow: null,
    };
  }

  setHost = (element: HTMLDivElement | null): void => {
    if (element) {
      this.setState({
        shadow: element.shadowRoot ?? element.attachShadow({ mode: 'open' }),
      });
    } else {
      this.setState({ shadow: null });
    }
  };

  componentDidMount(): void {
    this.refresh();
  }

  refresh = (): void => {
    refreshAll(() => window['ferdium'].features.unifiedInbox.inboxServices());
  };

  /** Click a row to read it here. Reads the message without opening it in
   *  Gmail, so it stays unread. */
  togglePreview = async (row: InboxRow): Promise<void> => {
    const key = rowKeyOf(row);
    if (this.state.openKey === key) {
      this.setState({ openKey: null });
      return;
    }
    this.setState({ openKey: key });
    if (this.state.previews[key]) return;
    this.setState(prev => ({
      previews: { ...prev.previews, [key]: 'loading' },
    }));
    const preview = await loadPreview(
      row,
      this.props.stores!.services.one(row.serviceId),
    );
    this.setState(prev => ({ previews: { ...prev.previews, [key]: preview } }));
  };

  toggle = (key: string): void => {
    this.setState(prev => ({
      selected: prev.selected.includes(key)
        ? prev.selected.filter(k => k !== key)
        : [...prev.selected, key],
    }));
  };

  /** Marks every ticked row read: one service at a time (each opens its own
   *  conversations), different services in parallel. */
  markSelectedRead = async (shown: InboxRow[]): Promise<void> => {
    const { stores, actions } = this.props;
    const markRead = INBOX_ACTIONS.find(a => a.id === 'markRead');
    const chosen = shown.filter(r => this.state.selected.includes(rowKeyOf(r)));
    if (!markRead || chosen.length === 0) return;

    const byService = new Map<string, InboxRow[]>();
    for (const row of chosen) {
      byService.set(row.serviceId, [
        ...(byService.get(row.serviceId) ?? []),
        row,
      ]);
    }
    let done = 0;
    setNotice(`Marking ${chosen.length} as read…`);
    await Promise.all(
      [...byService.values()].map(async group => {
        for (const row of group) {
          // eslint-disable-next-line no-await-in-loop
          await markRead.run(row, this.contextFor(row, stores, actions));
          done += 1;
          setNotice(`Marked ${done} of ${chosen.length} as read…`);
        }
      }),
    );
    setNotice(`Marked ${done} as read.`);
    this.setState({ selected: [] });
  };

  contextFor = (row: InboxRow, stores: any, actions: any) => ({
    service: stores!.services.one(row.serviceId),
    activateService: (serviceId: string) =>
      actions!.service.setActive({ serviceId }),
    close: () => setActive(false),
  });

  render(): ReactElement {
    const { stores, actions, theme } = this.props as any;
    const services = window['ferdium'].features.unifiedInbox
      .inboxServices()
      .filter((s: Service) => s.isEnabled);

    const rows: InboxRow[] = [];
    const problems: string[] = [];
    let total = 0;
    services.forEach((service: Service, i: number) => {
      const data = state.byService[service.id];
      if (!data) return;
      const color = COLORS[i % COLORS.length];
      total += data.accounts.reduce((sum, a) => sum + a.count, 0);
      for (const p of data.problems) problems.push(`${service.name} – ${p}`);
      for (const item of data.items) {
        rows.push({
          ...item,
          serviceId: service.id,
          serviceName: service.name,
          recipeId: service.recipe.id,
          color,
        });
      }
    });
    // Services that only report a count (Voice badges, Zoho) get one row each.
    const categoryRows = services.flatMap((service: Service, i: number) => {
      const data = state.byService[service.id];
      if (!data) return [];
      const count = data.accounts.reduce(
        (sum, account) => sum + account.count,
        0,
      );
      const categories = [...(data.categories ?? [])];
      if (count > 0 && data.items.length === 0 && categories.length === 0) {
        categories.push({
          id: 'inbox',
          label: 'Inbox',
          count,
          url: service.url,
        });
      }
      return categories.map(category => ({
        service,
        category,
        color: COLORS[i % COLORS.length],
      }));
    });
    rows.sort((a, b) => b.date - a.date);
    const { filter } = this.state;
    const shown = rows.filter(r => filter === null || r.serviceId === filter);
    const shownCategories = categoryRows.filter(
      r => filter === null || r.service.id === filter,
    );

    const selectedHere = shown.filter(r =>
      this.state.selected.includes(rowKeyOf(r)),
    );
    const allTicked = shown.length > 0 && selectedHere.length === shown.length;

    const openCategory = (service: Service, url: string) => {
      actions!.service.setActive({ serviceId: service.id });
      service.webview?.loadURL(url);
      setActive(false);
    };

    if (!state.isActive) return <div />;

    const runAction = (id: string, row: InboxRow, text?: string) => {
      INBOX_ACTIONS.find(a => a.id === id)?.run(
        row,
        this.contextFor(row, stores, actions),
        text,
      );
    };

    const noticeClass = /^Marked \d+ as read\.$|^Marked as read\.$/.test(
      state.notice,
    )
      ? classes.ok
      : classes.problem;

    const panel = (
      <>
        <style>{buildCss(theme)}</style>
        <div className={classes.panel}>
          <div className={classes.inner}>
            <div className={classes.header}>
              <h1 className={classes.headline}>Unified Inbox ({total})</h1>
              <div className={classes.toolbar}>
                <button
                  type="button"
                  className={`${classes.chip} ${this.state.filter === null ? classes.chipOn : ''}`}
                  style={{ background: '#5f6368' }}
                  onClick={() => this.setState({ filter: null })}
                >
                  All
                </button>
                {services.map((s: Service, i: number) => {
                  const count =
                    state.byService[s.id]?.accounts.reduce(
                      (sum, a) => sum + a.count,
                      0,
                    ) ?? 0;
                  return (
                    <button
                      type="button"
                      key={s.id}
                      className={`${classes.chip} ${this.state.filter === s.id ? classes.chipOn : ''}`}
                      style={{ background: COLORS[i % COLORS.length] }}
                      onClick={() => this.setState({ filter: s.id })}
                    >
                      {s.name} ({count})
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={classes.refresh}
                  onClick={this.refresh}
                >
                  {state.isRefreshing ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
              {state.notice && (
                <div className={`${classes.notice} ${noticeClass}`}>
                  {state.notice}
                </div>
              )}
              {problems.map(p => (
                <div key={p} className={`${classes.notice} ${classes.problem}`}>
                  {p}
                </div>
              ))}
              <div className={`${classes.grid} ${classes.thead}`}>
                <input
                  type="checkbox"
                  className={classes.check}
                  checked={allTicked}
                  disabled={shown.length === 0}
                  title="Select all"
                  onChange={() =>
                    this.setState({
                      selected: allTicked ? [] : shown.map(r => rowKeyOf(r)),
                    })
                  }
                />
                <div className={classes.cell}>
                  {selectedHere.length > 0 ? (
                    <button
                      type="button"
                      className={`${classes.action} ${classes.bulk}`}
                      onClick={() => this.markSelectedRead(shown)}
                    >
                      Mark read ({selectedHere.length})
                    </button>
                  ) : (
                    'Actions'
                  )}
                </div>
                <div className={classes.cell}>From</div>
                <div className={classes.cell}>Subject</div>
                <div className={classes.cell}>Preview</div>
                <div className={classes.cell}>Date / time</div>
                <div className={classes.cell}>Source</div>
              </div>
            </div>

            <div className={classes.list}>
              {shownCategories.map(({ service, category, color }) => (
                <div
                  key={`${service.id}-${category.id}`}
                  className={`${classes.grid} ${classes.row}`}
                  style={{ borderLeftColor: color }}
                >
                  <span />
                  <div className={classes.btns}>
                    <button
                      type="button"
                      className={classes.action}
                      onClick={() => openCategory(service, category.url)}
                    >
                      Open
                    </button>
                  </div>
                  <div className={`${classes.cell} ${classes.strong}`}>
                    {category.label}
                  </div>
                  <div className={classes.cell}>{category.count} unread</div>
                  <div className={`${classes.cell} ${classes.dim}`}>
                    Counts only: this service does not expose message details
                  </div>
                  <div className={`${classes.cell} ${classes.dim}`}>—</div>
                  <div className={classes.cell} style={{ color }}>
                    {service.name}
                  </div>
                </div>
              ))}

              {shown.length === 0 && shownCategories.length === 0 && (
                <div className={classes.empty}>
                  {Object.keys(state.byService).length === 0
                    ? 'Waiting for services to load…'
                    : 'No unread mail.'}
                </div>
              )}

              {shown.map((row, index) => {
                const label = dayLabel(row.date);
                const showDay =
                  index === 0 || dayLabel(shown[index - 1].date) !== label;
                const key = rowKeyOf(row);
                const ticked = this.state.selected.includes(key);
                const canReply = row.recipeId === 'gmail';
                return (
                  <Fragment key={key}>
                    {showDay && <div className={classes.day}>{label}</div>}
                    <div
                      className={`${classes.grid} ${classes.row} ${classes.clickable} ${ticked ? classes.rowSelected : ''}`}
                      style={{ borderLeftColor: row.color }}
                      role="presentation"
                      onKeyDown={noop}
                      onClick={event => {
                        if (
                          (event.target as HTMLElement).closest('button, input')
                        ) {
                          return;
                        }
                        this.togglePreview(row);
                      }}
                    >
                      <input
                        type="checkbox"
                        className={classes.check}
                        checked={ticked}
                        onChange={() => this.toggle(key)}
                      />
                      <div className={classes.btns}>
                        <button
                          type="button"
                          className={classes.action}
                          onClick={() => runAction('open', row)}
                        >
                          Open
                        </button>
                        {canReply && (
                          <button
                            type="button"
                            className={classes.action}
                            onClick={() =>
                              this.setState(prev => ({
                                replyKey: prev.replyKey === key ? null : key,
                                replyText: '',
                              }))
                            }
                          >
                            Reply
                          </button>
                        )}
                        <button
                          type="button"
                          className={classes.action}
                          onClick={() => runAction('markRead', row)}
                        >
                          Mark read
                        </button>
                      </div>
                      <div
                        className={`${classes.cell} ${classes.strong}`}
                        title={row.author}
                      >
                        {row.author}
                      </div>
                      <div className={classes.cell} title={row.title}>
                        {row.title === row.author ? '—' : row.title}
                      </div>
                      <div
                        className={`${classes.cell} ${classes.dim}`}
                        title={row.summary}
                      >
                        {row.summary}
                      </div>
                      <div className={classes.cell}>
                        {clock(row)}{' '}
                        <span className={classes.dim}>· {ago(row.date)}</span>
                      </div>
                      <div
                        className={classes.cell}
                        style={{ color: row.color }}
                        title={`${row.serviceName} ${row.accountEmail}`}
                      >
                        {row.serviceName}
                        {canReply ? ` · ${row.accountEmail}` : ''}
                      </div>
                    </div>
                    {this.state.openKey === key && (
                      <div
                        className={classes.preview}
                        style={{ borderLeftColor: row.color }}
                      >
                        {this.state.previews[key] === 'loading' ||
                        !this.state.previews[key] ? (
                          <div className={classes.dim}>Loading…</div>
                        ) : (
                          (() => {
                            const p = this.state.previews[key] as Preview;
                            return (
                              <>
                                <div className={classes.previewMeta}>
                                  {p.subject && (
                                    <div className={classes.strong}>
                                      {p.subject}
                                    </div>
                                  )}
                                  {p.from && <div>From: {p.from}</div>}
                                  {p.to && <div>To: {p.to}</div>}
                                  {p.date && <div>Date: {p.date}</div>}
                                </div>
                                <div className={classes.previewBody}>
                                  {p.body}
                                </div>
                                <div className={classes.dim}>
                                  {p.note ??
                                    'Preview only: this does not mark the message as read.'}
                                </div>
                              </>
                            );
                          })()
                        )}
                      </div>
                    )}
                    {this.state.replyKey === key && (
                      <div className={classes.reply}>
                        <input
                          className={classes.replyInput}
                          placeholder="Write a reply…"
                          value={this.state.replyText}
                          onChange={event =>
                            this.setState({ replyText: event.target.value })
                          }
                        />
                        <button
                          type="button"
                          className={classes.action}
                          onClick={() =>
                            runAction('reply', row, this.state.replyText)
                          }
                        >
                          Open draft
                        </button>
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>
      </>
    );

    return (
      <div
        ref={this.setHost}
        style={{ position: 'absolute', inset: 0, zIndex: 1000 }}
      >
        {this.state.shadow && createPortal(panel, this.state.shadow as any)}
      </div>
    );
  }
}

export default injectIntl(
  withStyles(() => ({}), { injectTheme: true })(UnifiedInboxView),
);
