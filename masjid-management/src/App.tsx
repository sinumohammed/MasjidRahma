import { useEffect, useState } from 'react';
import { Layout, Menu, Button, Dropdown, ConfigProvider, theme as antdTheme } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  SettingOutlined,
  TeamOutlined,
  CalendarOutlined,
  WalletOutlined,
  SoundOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import Dashboard, { type TransactionFilter } from './components/Dashboard';
import TransactionsList from './components/TransactionsList';
import MembersList from './components/Members/MembersList';
import YearlyScheduleView from './components/Members/YearlyScheduleView';
import ProfileView from './components/Members/ProfileView';
import MemberAvatar from './components/Members/MemberAvatar';
import SettingsPage from './components/SettingsPage';
import Announcements from './components/Announcements';
import AuthModal from './components/AuthModal';
import { useSettings } from './context/SettingsContext';
import { useAuth } from './context/AuthContext';
import { getMyProfile, type MemberType } from './services/api';
import './App.css';
import type { MenuProps } from 'antd';

// MemberAvatar looks up /assets/members/<id>.<ext> - reusing it for the
// admin's header icon by pointing at the same asset naming convention
// (public/assets/members/masjidrahma.jpg) rather than a separate component.
const ADMIN_AVATAR_ID = 'masjidrahma';

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

  const navigateToTransactions = (filter: TransactionFilter) => {
    setTransactionsFilter(filter);
    setActiveKey('transactions');
  };

  const navigateToMembers = (typeFilter?: MemberType) => {
    setMembersTypeFilter(typeFilter);
    setActiveKey('members');
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

  useEffect(() => {
    if (!isAdmin && activeKey === 'transactions') {
      setActiveKey('dashboard');
    }
    if (!isLoggedIn && (activeKey === 'profile' || activeKey === 'members' || activeKey === 'settings' || activeKey === 'announcements')) {
      setActiveKey('dashboard');
    }
  }, [isAdmin, isLoggedIn, activeKey]);

  // Land directly on Announcements when opened via a push-notification tap
  // (service worker sends url: '/?view=announcements') - only meaningful once
  // logged in, so the redirect effect above bounces it back to Dashboard for
  // anonymous visitors instead.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'announcements') {
      setActiveKey('announcements');
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
        ]
      : []),
    ...(isLoggedIn
      ? [
          {
            key: 'announcements',
            icon: <SoundOutlined />,
            label: 'Announcements',
          },
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
    { key: 'logout', icon: <LogoutOutlined />, label: 'Logout' },
  ];

  const handleUserMenuClick: MenuProps['onClick'] = (e) => {
    if (e.key === 'logout') logout();
  };

  const renderContent = () => {
    switch (activeKey) {
      case 'dashboard':
        return (
          <Dashboard
            onNavigateToTransactions={navigateToTransactions}
            onNavigateToYearlySchedule={openYearlySchedule}
            onNavigateToMembers={navigateToMembers}
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
          />
        );
      case 'members':
        return <MembersList initialTypeFilter={membersTypeFilter} />;
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
                    {!isAdmin && memberUniqueId ? (
                      <MemberAvatar key={memberUniqueId} uniqueId={memberUniqueId} size={28} />
                    ) : isAdmin ? (
                      <MemberAvatar key={ADMIN_AVATAR_ID} uniqueId={ADMIN_AVATAR_ID} size={28} />
                    ) : (
                      <UserOutlined />
                    )}
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
