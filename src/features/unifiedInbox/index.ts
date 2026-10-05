import { reaction } from 'mobx';
import type { Stores } from '../../@types/stores.types';
import { BADGE_ONLY, SOURCES, startPolling } from './poller';
import { setActive, state } from './store';

const debug = require('../../preload-safe-debug')(
  'Ferdium:feature:unifiedInbox',
);

/** A service is a child of the Unified Mailbox if it has a data source. */
export const isInboxService = (service: { recipe: { id: string } }): boolean =>
  SOURCES[service.recipe.id] !== undefined || BADGE_ONLY.has(service.recipe.id);

export default function initialize(stores: Stores) {
  debug('Initialize unifiedInbox feature');

  const inboxServices = () =>
    stores.services.all.filter(service => isInboxService(service));

  window['ferdium'].features.unifiedInbox = {
    state,
    inboxServices,
    open: (): void => setActive(true),
  };

  // Selecting any real service leaves the Unified Mailbox.
  reaction(
    () => (stores.services as any).active?.id,
    () => setActive(false),
  );

  startPolling(inboxServices);
}
