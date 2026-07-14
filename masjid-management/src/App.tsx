import { useState } from 'react';
import { Layout, Menu, Button, ConfigProvider, theme as antdTheme } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  SettingOutlined,
  TeamOutlined,
  CalendarOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import Dashboard from './components/Dashboard';
import TransactionsList from './components/TransactionsList';
import MembersList from './components/Members/MembersList';
import YearlyScheduleView from './components/Members/YearlyScheduleView';
import SettingsPage from './components/SettingsPage';
import AuthModal from './components/AuthModal';
import { useSettings } from './context/SettingsContext';
import { useAuth } from './context/AuthContext';
import './App.css';
import type { MenuProps } from 'antd';

function App() {
  const { theme } = useSettings();
  const { isAdmin, username, hasAdmin, logout } = useAuth();
  const [activeKey, setActiveKey] = useState<string>('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const menuItems: MenuProps['items'] = [
    {
      key: 'dashboard',
      icon: <DashboardOutlined />,
      label: 'Dashboard',
    },
    {
      key: 'transactions',
      icon: <FileTextOutlined />,
      label: 'Transactions',
    },
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

  const renderContent = () => {
    switch (activeKey) {
      case 'dashboard':
        return <Dashboard />;
      case 'transactions':
        return <TransactionsList />;
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
            {isAdmin ? (
              <>
                <span className="app-admin-username"><UserOutlined /> {username}</span>
                <Button className="app-header-auth-btn" icon={<LogoutOutlined />} onClick={logout}>
                  <span className="app-header-auth-btn-label">Logout</span>
                </Button>
              </>
            ) : (
              <Button
                className="app-header-auth-btn"
                type={hasAdmin === false ? 'primary' : 'default'}
                icon={<UserOutlined />}
                onClick={() => setAuthModalOpen(true)}
              >
                <span className="app-header-auth-btn-label">
                  {hasAdmin === false ? 'Set Up Admin Account' : 'Admin Login'}
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
