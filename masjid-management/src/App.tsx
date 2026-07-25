import { useEffect, useState } from 'react';
import { Layout, Menu, Button, Dropdown, ConfigProvider, theme as antdTheme } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  SettingOutlined,
  TeamOutlined,
  CalendarOutlined,
  WalletOutlined,
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
import AuthModal from './components/AuthModal';
import { useSettings } from './context/SettingsContext';
import { useAuth } from './context/AuthContext';
import { getMyProfile } from './services/api';
import './App.css';
import type { MenuProps } from 'antd';

function App() {
  const { theme } = useSettings();
  const { isAdmin, isLoggedIn, memberId, username, hasAdmin, logout } = useAuth();
  const [activeKey, setActiveKey] = useState<string>('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [memberUniqueId, setMemberUniqueId] = useState<string | null>(null);
  const [transactionsFilter, setTransactionsFilter] = useState<TransactionFilter | null>(null);

  const navigateToTransactions = (filter: TransactionFilter) => {
    setTransactionsFilter(filter);
    setActiveKey('transactions');
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
    if (!isLoggedIn && activeKey === 'profile') {
      setActiveKey('dashboard');
    }
  }, [isAdmin, isLoggedIn, activeKey]);

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
            key: 'profile',
            icon: <WalletOutlined />,
            label: 'Profile',
          },
        ]
      : []),
    {
      key: 'members',
      icon: <TeamOutlined />,
      label: 'Members',
    },
    {
      key: 'yearly-schedule',
      icon: <CalendarOutlined />,
      label: 'Yearly Schedule',
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Settings',
    },
  ];

  const openYearlySchedule = () => setActiveKey('yearly-schedule');

  const userMenuItems: MenuProps['items'] = [
    { key: 'username', label: username, disabled: true },
    { type: 'divider' },
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
          />
        );
      case 'profile':
        return isLoggedIn ? <ProfileView /> : <Dashboard />;
      case 'members':
        return <MembersList />;
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
              <Dropdown
                menu={{ items: userMenuItems, onClick: handleUserMenuClick }}
                trigger={['click']}
                placement="bottomRight"
              >
                <button type="button" className="app-header-user-btn">
                  {!isAdmin && memberUniqueId ? (
                    <MemberAvatar key={memberUniqueId} uniqueId={memberUniqueId} size={28} />
                  ) : (
                    <UserOutlined />
                  )}
                </button>
              </Dropdown>
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
