import { useEffect, useRef, useState } from 'react';
import { Layout, Menu, Button, Dropdown, Badge, ConfigProvider, theme as antdTheme } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  SettingOutlined,
  TeamOutlined,
  CalendarOutlined,
  WalletOutlined,
  BellOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
  HistoryOutlined,
  BankOutlined,
} from '@ant-design/icons';
import Dashboard, { type TransactionFilter } from './components/Dashboard';
import TransactionsList from './components/TransactionsList';
import BanksPage from './components/Banks/BanksPage';
import MembersList from './components/Members/MembersList';
import ActivityLog from './components/Admin/ActivityLog';
import YearlyScheduleView from './components/Members/YearlyScheduleView';
import ProfileView from './components/Members/ProfileView';
import MemberAvatar from './components/Members/MemberAvatar';
import SettingsPage from './components/SettingsPage';
import Announcements from './components/Announcements';
import MyNotifications from './components/MyNotifications';
import AuthModal from './components/AuthModal';
import { useSettings } from './context/SettingsContext';
import { useAuth } from './context/AuthContext';
import { getMyProfile, getAnnouncements, getMyNotifications, logActivity, type MemberType } from './services/api';
import './App.css';
import type { MenuProps } from 'antd';

// MemberAvatar looks up /assets/members/<id>.<ext> - reusing it for the
// admin's header icon by pointing at the same asset naming convention
// (public/assets/members/masjidrahma.jpg) rather than a separate component.
const ADMIN_AVATAR_ID = 'masjidrahma';

// Per-device, per-account "last read" timestamp for the announcement bell -
// keyed by username so switching accounts on the same browser doesn't leak
// one account's read state into another's.
const ANNOUNCEMENTS_READ_KEY_PREFIX = 'masjid_announcements_read_at_';
const getAnnouncementsReadKey = (user: string | null) => `${ANNOUNCEMENTS_READ_KEY_PREFIX}${user || 'anonymous'}`;
const MY_NOTIFICATIONS_READ_KEY_PREFIX = 'masjid_my_notifications_read_at_';
const getMyNotificationsReadKey = (user: string | null) => `${MY_NOTIFICATIONS_READ_KEY_PREFIX}${user || 'anonymous'}`;

function App() {
  const { theme } = useSettings();
  const { isAdmin, isLoggedIn, memberId, username, hasAdmin, logout } = useAuth();
  const [activeKey, setActiveKey] = useState<string>('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [memberUniqueId, setMemberUniqueId] = useState<string | null>(null);
  const [transactionsFilter, setTransactionsFilter] = useState<TransactionFilter | null>(null);
  const [membersTypeFilter, setMembersTypeFilter] = useState<MemberType | undefined>(undefined);
  const [banksFilter, setBanksFilter] = useState<string | undefined>(undefined);
  const [unreadAnnouncements, setUnreadAnnouncements] = useState(0);
  const [unreadMyNotifications, setUnreadMyNotifications] = useState(0);

  const navigateToTransactions = (filter: TransactionFilter) => {
    setTransactionsFilter(filter);
    setActiveKey('transactions');
  };

  const navigateToMembers = (typeFilter?: MemberType) => {
    setMembersTypeFilter(typeFilter);
    setActiveKey('members');
  };

  const navigateToBanks = (bankId?: string) => {
    setBanksFilter(bankId);
    setActiveKey('banks');
  };

  const openAnnouncements = () => setActiveKey('announcements');
  const openMyNotifications = () => setActiveKey('my-notifications');

  useEffect(() => {
    if (!isLoggedIn || isAdmin || !memberId) {
      setMemberUniqueId(null);
      return;
    }
    let ignore = false;
    getMyProfile()
      .then((profile) => {
        if (!ignore) setMemberUniqueId(profile.member.unique_id);
      })
      .catch(() => {
        if (!ignore) setMemberUniqueId(null);
      });
    return () => {
      ignore = true;
    };
  }, [isLoggedIn, isAdmin, memberId]);

  // Log a page_visit whenever the active view changes - deduped against the
  // last-logged key so React StrictMode's double-mount in dev (and any
  // no-op re-render that leaves activeKey unchanged) doesn't double-count.
  const lastLoggedViewRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastLoggedViewRef.current === activeKey) return;
    lastLoggedViewRef.current = activeKey;
    logActivity('page_visit', activeKey);
  }, [activeKey]);

  useEffect(() => {
    if (!isAdmin && (activeKey === 'transactions' || activeKey === 'activity' || activeKey === 'banks')) {
      setActiveKey('dashboard');
    }
    if (
      !isLoggedIn &&
      (activeKey === 'profile' ||
        activeKey === 'members' ||
        activeKey === 'settings' ||
        activeKey === 'announcements' ||
        activeKey === 'my-notifications')
    ) {
      setActiveKey('dashboard');
    }
    // My Notifications is member-specific - admins have no personal
    // notifications of their own, so bounce them to Dashboard too.
    if (isAdmin && activeKey === 'my-notifications') {
      setActiveKey('dashboard');
    }
  }, [isAdmin, isLoggedIn, activeKey]);

  // Poll for the announcement bell's unread count - compares each
  // announcement's created_at against this account's last-read timestamp.
  useEffect(() => {
    if (!isLoggedIn) {
      setUnreadAnnouncements(0);
      return;
    }
    let ignore = false;
    const checkUnread = async () => {
      try {
        const list = await getAnnouncements();
        if (ignore) return;
        const lastReadAt = localStorage.getItem(getAnnouncementsReadKey(username));
        const lastReadTime = lastReadAt ? new Date(lastReadAt).getTime() : 0;
        setUnreadAnnouncements(list.filter((a) => new Date(a.created_at).getTime() > lastReadTime).length);
      } catch {
        // Best-effort - a failed fetch shouldn't disrupt the header.
      }
    };
    checkUnread();
    const interval = setInterval(checkUnread, 120000);
    // Mobile browsers/PWAs throttle or suspend the interval above while the
    // app is backgrounded, so the badge can go stale for the whole time it's
    // minimized - re-check immediately the moment it's foregrounded again
    // rather than waiting for the next interval tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkUnread();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', checkUnread);
    return () => {
      ignore = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', checkUnread);
    };
  }, [isLoggedIn, username]);

  // Poll for the My Notifications bell's unread count, same pattern as
  // announcements above but scoped to this member's own notifications and a
  // separate last-read timestamp.
  useEffect(() => {
    if (!isLoggedIn || isAdmin) {
      setUnreadMyNotifications(0);
      return;
    }
    let ignore = false;
    const checkUnread = async () => {
      try {
        const list = await getMyNotifications();
        if (ignore) return;
        const lastReadAt = localStorage.getItem(getMyNotificationsReadKey(username));
        const lastReadTime = lastReadAt ? new Date(lastReadAt).getTime() : 0;
        setUnreadMyNotifications(list.filter((n) => new Date(n.created_at).getTime() > lastReadTime).length);
      } catch {
        // Best-effort - a failed fetch shouldn't disrupt the header.
      }
    };
    checkUnread();
    const interval = setInterval(checkUnread, 120000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkUnread();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', checkUnread);
    return () => {
      ignore = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', checkUnread);
    };
  }, [isLoggedIn, isAdmin, username]);

  // Opening Announcements or My Notifications (menu tap or push-notification
  // deep link) marks that list read up to now.
  useEffect(() => {
    if (activeKey === 'announcements' && isLoggedIn) {
      localStorage.setItem(getAnnouncementsReadKey(username), new Date().toISOString());
      setUnreadAnnouncements(0);
    }
    if (activeKey === 'my-notifications' && isLoggedIn) {
      localStorage.setItem(getMyNotificationsReadKey(username), new Date().toISOString());
      setUnreadMyNotifications(0);
    }
  }, [activeKey, isLoggedIn, username]);

  // Land directly on Announcements or My Notifications when opened via a
  // push-notification tap (service worker sends url: '/?view=<key>') - only
  // meaningful once logged in, so the redirect effect above bounces it back
  // to Dashboard for anonymous visitors instead.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    if (view === 'announcements' || view === 'my-notifications') {
      setActiveKey(view);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const menuItems: MenuProps['items'] = [
    {
      key: 'dashboard',
      icon: <DashboardOutlined />,
      label: 'Dashboard',
    },
    ...(isAdmin
      ? [
          {
            key: 'transactions',
            icon: <FileTextOutlined />,
            label: 'Transactions',
          },
          {
            key: 'banks',
            icon: <BankOutlined />,
            label: 'Banks',
          },
        ]
      : []),
    ...(isLoggedIn
      ? [
          {
            key: 'profile',
            icon: <WalletOutlined />,
            label: 'Profile',
          },
        ]
      : []),
    ...(isLoggedIn
      ? [
          {
            key: 'members',
            icon: <TeamOutlined />,
            label: 'Members',
          },
        ]
      : []),
    {
      key: 'yearly-schedule',
      icon: <CalendarOutlined />,
      label: 'Yearly Schedule',
    },
    ...(isAdmin
      ? [
          {
            key: 'activity',
            icon: <HistoryOutlined />,
            label: 'Activity',
          },
        ]
      : []),
    ...(isLoggedIn
      ? [
          {
            key: 'settings',
            icon: <SettingOutlined />,
            label: 'Settings',
          },
        ]
      : []),
  ];

  const openYearlySchedule = () => setActiveKey('yearly-schedule');

  const userMenuItems: MenuProps['items'] = [
    ...(!isAdmin
      ? [
          {
            key: 'my-notifications',
            icon: <BellOutlined />,
            label: (
              <span className="app-user-menu-announcements">
                My Notifications
                {unreadMyNotifications > 0 && <Badge count={unreadMyNotifications} size="small" />}
              </span>
            ),
          },
        ]
      : []),
    {
      key: 'announcements',
      icon: <BellOutlined />,
      label: (
        <span className="app-user-menu-announcements">
          Announcements
          {unreadAnnouncements > 0 && <Badge count={unreadAnnouncements} size="small" />}
        </span>
      ),
    },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Logout' },
  ];

  const handleUserMenuClick: MenuProps['onClick'] = (e) => {
    if (e.key === 'logout') logout();
    if (e.key === 'announcements') setActiveKey('announcements');
    if (e.key === 'my-notifications') setActiveKey('my-notifications');
  };

  const renderContent = () => {
    switch (activeKey) {
      case 'dashboard':
        return (
          <Dashboard
            onNavigateToTransactions={navigateToTransactions}
            onNavigateToYearlySchedule={openYearlySchedule}
            onNavigateToMembers={navigateToMembers}
            onNavigateToBanks={navigateToBanks}
            onOpenAnnouncements={openAnnouncements}
            onOpenMyNotifications={openMyNotifications}
            unreadAnnouncements={unreadAnnouncements}
            unreadMyNotifications={unreadMyNotifications}
          />
        );
      case 'transactions':
        return isAdmin ? (
          <TransactionsList
            initialTypeFilter={transactionsFilter?.type}
            initialCategoryFilter={transactionsFilter?.category}
          />
        ) : (
          <Dashboard
            onNavigateToTransactions={navigateToTransactions}
            onNavigateToYearlySchedule={openYearlySchedule}
            onNavigateToMembers={navigateToMembers}
            onNavigateToBanks={navigateToBanks}
            onOpenAnnouncements={openAnnouncements}
            onOpenMyNotifications={openMyNotifications}
            unreadAnnouncements={unreadAnnouncements}
            unreadMyNotifications={unreadMyNotifications}
          />
        );
      case 'banks':
        return isAdmin ? (
          <BanksPage initialBankId={banksFilter} />
        ) : (
          <Dashboard
            onNavigateToTransactions={navigateToTransactions}
            onNavigateToYearlySchedule={openYearlySchedule}
            onNavigateToMembers={navigateToMembers}
            onNavigateToBanks={navigateToBanks}
            onOpenAnnouncements={openAnnouncements}
            onOpenMyNotifications={openMyNotifications}
            unreadAnnouncements={unreadAnnouncements}
            unreadMyNotifications={unreadMyNotifications}
          />
        );
      case 'profile':
        return isLoggedIn ? <ProfileView /> : <Dashboard />;
      case 'announcements':
        return isLoggedIn ? (
          <Announcements />
        ) : (
          <Dashboard
            onNavigateToTransactions={navigateToTransactions}
            onNavigateToYearlySchedule={openYearlySchedule}
            onNavigateToMembers={navigateToMembers}
            onNavigateToBanks={navigateToBanks}
            onOpenAnnouncements={openAnnouncements}
            onOpenMyNotifications={openMyNotifications}
            unreadAnnouncements={unreadAnnouncements}
            unreadMyNotifications={unreadMyNotifications}
          />
        );
      case 'my-notifications':
        return isLoggedIn && !isAdmin ? (
          <MyNotifications />
        ) : (
          <Dashboard
            onNavigateToTransactions={navigateToTransactions}
            onNavigateToYearlySchedule={openYearlySchedule}
            onNavigateToMembers={navigateToMembers}
            onNavigateToBanks={navigateToBanks}
            onOpenAnnouncements={openAnnouncements}
            onOpenMyNotifications={openMyNotifications}
            unreadAnnouncements={unreadAnnouncements}
            unreadMyNotifications={unreadMyNotifications}
          />
        );
      case 'members':
        return <MembersList initialTypeFilter={membersTypeFilter} />;
      case 'activity':
        return isAdmin ? <ActivityLog /> : <Dashboard />;
      case 'yearly-schedule':
        return <YearlyScheduleView />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <Dashboard />;
    }
  };

  const handleMenuClick: MenuProps['onClick'] = (e) => {
    if (e.key === 'transactions') setTransactionsFilter(null);
    if (e.key === 'members') setMembersTypeFilter(undefined);
    if (e.key === 'banks') setBanksFilter(undefined);
    setActiveKey(e.key);
    if (isMobile) setCollapsed(true);
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      }}
    >
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        collapsedWidth={isMobile ? 0 : 80}
        breakpoint="lg"
        onBreakpoint={(broken) => {
          setIsMobile(broken);
          setCollapsed(broken);
        }}
        className={isMobile ? 'app-sider-mobile' : undefined}
      >
        <div className="app-logo">
          <h2>{collapsed && !isMobile ? '🕌' : '🕌 Masjid'}</h2>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[activeKey]}
          items={menuItems}
          onClick={handleMenuClick}
        />
      </Layout.Sider>
      {isMobile && !collapsed && (
        <div className="app-sider-backdrop" onClick={() => setCollapsed(true)} />
      )}
      <Layout>
        <Layout.Header style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            className="sider-trigger-btn"
          />
          <div className="app-header-title">
            Masjid Rahma
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isLoggedIn ? (
              <div className="app-header-user">
                <span className="app-header-user-id">{username}</span>
                <Dropdown
                  menu={{ items: userMenuItems, onClick: handleUserMenuClick }}
                  trigger={['click']}
                  placement="bottomRight"
                >
                  <button type="button" className="app-header-user-btn">
                    <Badge count={unreadAnnouncements + unreadMyNotifications} size="small" offset={[-2, 2]}>
                      {!isAdmin && memberUniqueId ? (
                        <MemberAvatar key={memberUniqueId} uniqueId={memberUniqueId} size={28} />
                      ) : isAdmin ? (
                        <MemberAvatar key={ADMIN_AVATAR_ID} uniqueId={ADMIN_AVATAR_ID} size={28} />
                      ) : (
                        <UserOutlined />
                      )}
                    </Badge>
                  </button>
                </Dropdown>
              </div>
            ) : (
              <Button
                className="app-header-auth-btn"
                type={hasAdmin === false ? 'primary' : 'default'}
                icon={<UserOutlined />}
                onClick={() => setAuthModalOpen(true)}
              >
                <span className="app-header-auth-btn-label">
                  {hasAdmin === false ? 'Set Up Admin Account' : 'Login'}
                </span>
              </Button>
            )}
          </div>
        </Layout.Header>
        <Layout.Content style={{ margin: '16px' }}>
          {renderContent()}
        </Layout.Content>
        <Layout.Footer style={{ textAlign: 'center', color: '#8c8c8c' }}>
          © 2026 Masjid Rahma | By Sinu
        </Layout.Footer>
      </Layout>
    </Layout>
    <AuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </ConfigProvider>
  );
}

export default App;
