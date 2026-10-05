import { observer } from 'mobx-react';
import { Component, type ComponentType } from 'react';

import { mdiEmailMultiple } from '@mdi/js';
import { isInboxService } from '../../../features/unifiedInbox';
import {
  setActive as setUnifiedActive,
  state,
  totalUnread,
} from '../../../features/unifiedInbox/store';
import type Service from '../../../models/Service';
import TabBarSortableListBase from './TabBarSortableList';

// react-sortable-hoc's typings drop our extra props; widen them here.
const SortableList = TabBarSortableListBase as unknown as ComponentType<any>;

interface IProps {
  useHorizontalStyle: boolean;
  showMessageBadgeWhenMutedSetting: boolean;
  showServiceNameSetting: boolean;
  showMessageBadgesEvenWhenMuted: boolean;
  services: Service[];
  setActive: (args: { serviceId: string }) => void;
  openSettings: (args: { path: string }) => void;
  enableToolTip: () => void;
  disableToolTip: () => void;
  reorder: (args: { oldIndex: number; newIndex: number }) => void;
  reload: (args: { serviceId: string }) => void;
  toggleNotifications: (args: { serviceId: string }) => void;
  toggleAudio: (args: { serviceId: string }) => void;
  toggleDarkMode: (args: { serviceId: string }) => void;
  deleteService: (args: { serviceId: string }) => void;
  clearCache: (args: { serviceId: string }) => void;
  hibernateService: (args: { serviceId: string }) => void;
  wakeUpService: (args: { serviceId: string }) => void;
  updateService: (args: {
    serviceId: string;
    serviceData: { isEnabled: boolean; isMediaPlaying: boolean };
    redirect: boolean;
  }) => void;
}

@observer
class TabBar extends Component<IProps> {
  shouldPreventSorting = event => event.target.tagName !== 'LI';

  toggleService = (args: { serviceId: string; isEnabled: boolean }) => {
    const { updateService } = this.props;

    if (args.serviceId) {
      updateService({
        serviceId: args.serviceId,
        serviceData: {
          isEnabled: args.isEnabled,
          isMediaPlaying: false,
        },
        redirect: false,
      });
    }
  };

  disableService({ serviceId }) {
    this.toggleService({ serviceId, isEnabled: false });
  }

  enableService({ serviceId }) {
    this.toggleService({ serviceId, isEnabled: true });
  }

  hibernateService({ serviceId }) {
    if (serviceId) {
      this.props.hibernateService({ serviceId });
    }
  }

  wakeUpService({ serviceId }) {
    if (serviceId) {
      this.props.wakeUpService({ serviceId });
    }
  }

  render() {
    const {
      services,
      setActive,
      openSettings,
      disableToolTip,
      reload,
      toggleNotifications,
      toggleAudio,
      toggleDarkMode,
      deleteService,
      clearCache,
      useHorizontalStyle,
      showMessageBadgeWhenMutedSetting,
      showServiceNameSetting,
      showMessageBadgesEvenWhenMuted,
    } = this.props;

    const axis = useHorizontalStyle ? 'x' : 'y';

    // Unified Mailbox: parent entry + its mail services as indented children.
    const children = services.filter(service => isInboxService(service));
    const others = services.filter(service => !isInboxService(service));
    const unread = totalUnread();
    const mailboxIcon = `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#1a73e8"/><g transform="translate(3.6 3.6) scale(0.7)"><path fill="#fff" d="${mdiEmailMultiple}"/></g></svg>`,
    )}`;
    const sharedProps = {
      setActive: (args: { serviceId: string }) => {
        setUnifiedActive(false);
        setActive(args);
      },
      onSortStart: disableToolTip,
      shouldCancelStart: this.shouldPreventSorting,
      reload,
      toggleNotifications,
      toggleAudio,
      toggleDarkMode,
      deleteService,
      clearCache,
      disableService: args => this.disableService(args),
      enableService: args => this.enableService(args),
      hibernateService: args => this.hibernateService(args),
      wakeUpService: args => this.wakeUpService(args),
      openSettings,
      distance: 20,
      axis,
      lockAxis: axis,
      helperClass: 'is-reordering',
      showMessageBadgeWhenMutedSetting,
      showServiceNameSetting,
      showMessageBadgesEvenWhenMuted,
      useHorizontalStyle,
    };

    return (
      <div className="sidebar__services">
        <div
          style={{
            display: 'flex',
            flexDirection: useHorizontalStyle ? 'row' : 'column',
            gap: 'var(--webview-padding)',
            minWidth: 0,
            width: '100%',
          }}
        >
          {children.length > 0 && (
            <>
              <ul className="tabs">
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: sidebar tab, mouse only like the service tabs */}
                <li
                  className={`tab-item${state.isActive ? ' is-active' : ''}${
                    showServiceNameSetting ? ' is-label-enabled' : ''
                  }`}
                  onClick={() => setUnifiedActive(true)}
                  role="presentation"
                  data-tooltip-id="tooltip-sidebar-button"
                  data-tooltip-content={`Unified Mailbox (${unread})`}
                >
                  <img src={mailboxIcon} className="tab-item__icon" alt="" />
                  {showServiceNameSetting && (
                    <span className="tab-item__label">Unified Mailbox</span>
                  )}
                  {unread > 0 && (
                    <span className="tab-item__message-count">{unread}</span>
                  )}
                </li>
              </ul>
              <SortableList
                services={children}
                {...sharedProps}
                onSortEnd={({ oldIndex, newIndex }) => {
                  this.props.enableToolTip();
                  this.props.reorder({
                    oldIndex: services.indexOf(children[oldIndex]),
                    newIndex: services.indexOf(children[newIndex]),
                  });
                }}
                listClassName="tabs--unified-children"
                getShortcutIndex={service => services.indexOf(service) + 1}
              />
            </>
          )}
          <SortableList
            services={others}
            {...sharedProps}
            onSortEnd={({ oldIndex, newIndex }) => {
              this.props.enableToolTip();
              this.props.reorder({
                oldIndex: services.indexOf(others[oldIndex]),
                newIndex: services.indexOf(others[newIndex]),
              });
            }}
            getShortcutIndex={service => services.indexOf(service) + 1}
          />
        </div>
      </div>
    );
  }
}

export default TabBar;
