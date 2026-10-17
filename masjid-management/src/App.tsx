import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Layout, Menu, Button, Dropdown, Badge, ConfigProvider, Drawer } from 'antd';
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
  HomeOutlined,
  AppstoreOutlined,
  LoginOutlined,
  InfoCircleOutlined,
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
import AssistantChat from './components/AssistantChat';
import AboutMasjid from './components/About/AboutMasjid';
import AssistantIcon from './components/AssistantIcon';
import AuthModal from './components/AuthModal';
import BrandMark from './components/BrandMark';
import { appTheme } from './theme';
import { useSettings } from './context/SettingsContext';
import { useAuth } from './context/AuthContext';
import {
  getMyProfile,
  getAnnouncements,
  getMyNotifications,
  getAssistantStatus,
  logActivity,
  SESSION_EXPIRED_EVENT,
  type MemberType,
} from './services/api';
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

// Views a session is required for - Dashboard and Yearly Schedule are
// intentionally excluded, they must stay visible to anonymous/expired
// visitors, so a SESSION_EXPIRED_EVENT while sitting on one of those must
// not pop the login modal uninvited.
const SESSION_REQUIRED_KEYS = new Set([
  'transactions',
  'banks',
  'activity',
  'profile',
  'members',
  'settings',
  'announcements',
  'my-notifications',
]);

// The header's title for each view (desktop; phones show the masjid's name).
const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  transactions: 'Transactions',
  banks: 'Banks',
  profile: 'Profile',
  members: 'Members',
  'yearly-schedule': 'Yearly Schedule',
  assistant: 'Assistant',
  activity: 'Activity',
  settings: 'Settings',
  announcements: 'Announcements',
  'my-notifications': 'My Notifications',
  about: 'About Masjid Rahma',
};

function App() {
  const { theme } = useSettings();
  const { isAdmin, isLoggedIn, memberId, username, hasAdmin, logout, checkSessionExpiry } = useAuth();
  const [activeKey, setActiveKey] = useState<string>('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  // The Assistant (menu item and floating button) shows only when the server
  // has the AI settings (AI_ASK_URL, AI_ASK_KEY) - asked again on login and
  // logout. Not logged in, it answers the food-duty schedule only.
  const [assistantAvailable, setAssistantAvailable] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getAssistantStatus()
      .then(({ available }) => !cancelled && setAssistantAvailable(available))
      .catch(() => !cancelled && setAssistantAvailable(false));
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, username]);
  const [isMobile, setIsMobile] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [memberUniqueId, setMemberUniqueId] = useState<string | null>(null);
  const [transactionsFilter, setTransactionsFilter] = useState<TransactionFilter | null>(null);
  const [membersTypeFilter, setMembersTypeFilter] = useState<MemberType | undefined>(undefined);
  const [banksFilter, setBanksFilter] = useState<string | undefined>(undefined);
  const [unreadAnnouncements, setUnreadAnnouncements] = useState(0);
  const [unreadMyNotifications, setUnreadMyNotifications] = useState(0);

  const navigateToTransactions = (filter: TransactionFilter) => {
    checkSessionExpiry();
    setTransactionsFilter(filter);
    setActiveKey('transactions');
  };

  const navigateToMembers = (typeFilter?: MemberType) => {
    checkSessionExpiry();
    setMembersTypeFilter(typeFilter);
    setActiveKey('members');
  };

  const navigateToBanks = (bankId?: string) => {
    checkSessionExpiry();
    setBanksFilter(bankId);
    setActiveKey('banks');
  };

  const openAnnouncements = () => {
    checkSessionExpiry();
    setActiveKey('announcements');
  };
  const openMyNotifications = () => {
    checkSessionExpiry();
    setActiveKey('my-notifications');
  };

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

  // A dead/expired token surfaces as a 401 from apiFetch (see services/api.ts)
  // or from AuthContext's focus/visibilitychange recheck, either of which
  // clears the session and fires this event - pop the login modal, but only
  // if the page currently on screen actually needs a session (Dashboard and
  // Yearly Schedule don't, and shouldn't get an uninvited login prompt).
  useEffect(() => {
    const onSessionExpired = () => {
      if (SESSION_REQUIRED_KEYS.has(activeKey)) setAuthModalOpen(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  }, [activeKey]);

  // Most GETs are public (see CLAUDE.md), so simply sitting on/navigating to
  // an admin page never calls a protected endpoint and never trips the
  // apiFetch 401 interceptor on its own - re-check the token's exp on every
  // navigation so a session that died while this tab sat open still gets
  // caught before isAdmin/isLoggedIn are read below.
  useEffect(() => {
    checkSessionExpiry();
  }, [activeKey, checkSessionExpiry]);

  useEffect(() => {
    if (!isAdmin && (activeKey === 'transactions' || activeKey === 'activity' || activeKey === 'banks')) {
      setActiveKey('dashboard');
      // Only pop the login modal for a dropped/missing session - a member
      // who's logged in but just isn't an admin doesn't need a login prompt,
      // they need to be on Dashboard instead.
      if (!isLoggedIn) setAuthModalOpen(true);
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
      setAuthModalOpen(true);
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
  // meaningful once logged in, so the redirect effect above bounces an
  // anonymous visitor back to Dashboard and pops the login modal instead.
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
    ...(assistantAvailable
      ? [
          {
            key: 'assistant',
            icon: <span className="anticon"><AssistantIcon size={18} /></span>,
            label: 'Assistant',
          },
        ]
      : []),
    {
      key: 'about',
      icon: <InfoCircleOutlined />,
      label: 'About',
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

  // Phones: the main places as tabs at the bottom, within thumb reach; the
  // rest of the menu stays in the sidebar, opened with "More".
  const goTo = (key: string) => {
    checkSessionExpiry();
    if (key === 'transactions') setTransactionsFilter(null);
    setActiveKey(key);
    setCollapsed(true);
  };
  const bottomTabs: { key: string; label: string; icon: ReactNode; onClick: () => void; badge?: number }[] = [
    { key: 'dashboard', label: 'Home', icon: <HomeOutlined />, onClick: () => goTo('dashboard') },
    { key: 'yearly-schedule', label: 'Schedule', icon: <CalendarOutlined />, onClick: () => goTo('yearly-schedule') },
    ...(assistantAvailable
      ? [{ key: 'assistant', label: 'Assistant', icon: <span className="anticon"><AssistantIcon size={24} /></span>, onClick: () => setAssistantOpen(true) }]
      : []),
    ...(isAdmin
      ? [{ key: 'transactions', label: 'Accounts', icon: <FileTextOutlined />, onClick: () => goTo('transactions') }]
      : isLoggedIn
        ? [{ key: 'profile', label: 'Profile', icon: <WalletOutlined />, onClick: () => goTo('profile'), badge: unreadMyNotifications }]
        : [{ key: 'login', label: 'Log in', icon: <LoginOutlined />, onClick: () => setAuthModalOpen(true) }]),
    { key: 'more', label: 'More', icon: <AppstoreOutlined />, onClick: () => setCollapsed(false) },
  ];

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
    if (e.key === 'announcements' || e.key === 'my-notifications') {
      checkSessionExpiry();
      setActiveKey(e.key);
    }
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
            onLogin={() => setAuthModalOpen(true)}
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
            onLogin={() => setAuthModalOpen(true)}
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
            onLogin={() => setAuthModalOpen(true)}
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
            onLogin={() => setAuthModalOpen(true)}
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
            onLogin={() => setAuthModalOpen(true)}
          />
        );
      case 'members':
        return isLoggedIn ? <MembersList initialTypeFilter={membersTypeFilter} /> : <Dashboard />;
      case 'activity':
        return isAdmin ? <ActivityLog /> : <Dashboard />;
      case 'yearly-schedule':
        return <YearlyScheduleView />;
      case 'settings':
        return isLoggedIn ? <SettingsPage /> : <Dashboard />;
      case 'about':
        return <AboutMasjid />;
      case 'assistant':
        return assistantAvailable ? <AssistantChat /> : <Dashboard />;
      default:
        return <Dashboard />;
    }
  };

  const handleMenuClick: MenuProps['onClick'] = (e) => {
    checkSessionExpiry();
    if (e.key === 'transactions') setTransactionsFilter(null);
    if (e.key === 'members') setMembersTypeFilter(undefined);
    if (e.key === 'banks') setBanksFilter(undefined);
    setActiveKey(e.key);
    if (isMobile) setCollapsed(true);
  };

  return (
    <ConfigProvider theme={appTheme(theme)}>
    <Layout className={`app-layout${isMobile ? ' has-bottom-nav' : ''}`}>
      <Layout.Sider
        width={248}
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
        <div className={`app-brand${collapsed && !isMobile ? ' is-collapsed' : ''}`}>
          <BrandMark size={40} />
          {(!collapsed || isMobile) && (
            <div className="app-brand-text">
              <span className="app-brand-name">Masjid Rahma</span>
              <span className="app-brand-sub">Food rota · Accounts</span>
            </div>
          )}
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
        <Layout.Header className="app-header">
          {isMobile ? (
            <div className="app-header-brand">
              <BrandMark size={32} />
              <span>Masjid Rahma</span>
            </div>
          ) : (
            <>
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed(!collapsed)}
                className="sider-trigger-btn"
                aria-label={collapsed ? 'Open the menu' : 'Close the menu'}
              />
              <h1 className="app-header-title">{PAGE_TITLES[activeKey] ?? 'Masjid Rahma'}</h1>
            </>
          )}
          <div className="app-header-actions">
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
            ) : isMobile && hasAdmin !== false ? null : (
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
        <Layout.Content className="app-content">
          <div className="app-page">{renderContent()}</div>
        </Layout.Content>
        <Layout.Footer className="app-footer">© 2026 Masjid Rahma · By Sinu</Layout.Footer>
      </Layout>
    </Layout>
    {isMobile && (
      <nav className="app-bottom-nav" aria-label="Main">
        {bottomTabs.map((t) => {
          const active = t.key === 'more' ? !collapsed : t.key === 'assistant' ? assistantOpen : t.key === activeKey && collapsed && !assistantOpen;
          return (
            <button key={t.key} type="button" className={`app-bottom-tab${active ? ' is-active' : ''}`} onClick={t.onClick} aria-current={active ? 'page' : undefined}>
              <Badge count={t.badge ?? 0} size="small" offset={[4, -2]}>
                <span className="app-bottom-tab-icon">{t.icon}</span>
              </Badge>
              <span className="app-bottom-tab-label">{t.label}</span>
            </button>
          );
        })}
      </nav>
    )}
    {/* The assistant from any screen, logged in or not - except its own page.
        On phones it is a bottom tab instead of the floating button. */}
    {assistantAvailable && activeKey !== 'assistant' && (
      <>
        {!isMobile && <button type="button" className="assistant-launcher" onClick={() => setAssistantOpen(true)} aria-label="Ask the masjid assistant" title="Ask the masjid assistant">
          <AssistantIcon size={38} bare />
          <span className="assistant-launcher-label">Ask Assistant</span>
        </button>}
        <Drawer
          title={null}
          closable={false}
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
          placement="right"
          size={isMobile ? '100%' : 460}
          destroyOnHidden
          styles={{ body: { padding: 0, overflow: 'hidden' } }}
        >
          <AssistantChat embedded onClose={() => setAssistantOpen(false)} />
        </Drawer>
      </>
    )}
    <AuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </ConfigProvider>
  );
}

export default App;
