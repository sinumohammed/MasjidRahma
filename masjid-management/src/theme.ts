import { theme as antdTheme, type ThemeConfig } from 'antd';
import type { ThemeMode } from './context/SettingsContext';

// antd's colours, from the same palette as the app's own tokens (index.css),
// so buttons, inputs, tables and menus match the rest of every screen.
export function appTheme(mode: ThemeMode): ThemeConfig {
  const dark = mode === 'dark';
  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: dark ? '#35b98f' : '#0f6b52',
      colorInfo: dark ? '#35b98f' : '#0f6b52',
      colorSuccess: dark ? '#35b98f' : '#14805f',
      colorWarning: dark ? '#ddb257' : '#b07d1c',
      colorError: dark ? '#f07a95' : '#be3455',
      colorLink: dark ? '#4fd1a7' : '#0f6b52',
      colorBgLayout: dark ? '#0b1310' : '#f5f2ea',
      colorBgContainer: dark ? '#121d19' : '#ffffff',
      colorBgElevated: dark ? '#17241f' : '#ffffff',
      colorBorder: dark ? '#2e4439' : '#d6cdb8',
      colorBorderSecondary: dark ? '#22332c' : '#e6e0d1',
      colorText: dark ? '#e7eee9' : '#18251f',
      colorTextSecondary: dark ? '#8fa198' : '#6b7a72',
      // Notices (Alert, message): soft tints of the palette - generated from
      // the deep emerald, antd's own came out a murky grey-green.
      colorInfoBg: dark ? 'rgba(53, 185, 143, 0.12)' : '#e6f2ec',
      colorInfoBorder: dark ? 'rgba(53, 185, 143, 0.35)' : '#bcdccb',
      colorSuccessBg: dark ? 'rgba(53, 185, 143, 0.12)' : '#e6f2ec',
      colorSuccessBorder: dark ? 'rgba(53, 185, 143, 0.35)' : '#bcdccb',
      colorWarningBg: dark ? 'rgba(221, 178, 87, 0.12)' : '#f8efd9',
      colorWarningBorder: dark ? 'rgba(221, 178, 87, 0.35)' : '#e8d2a0',
      colorErrorBg: dark ? 'rgba(240, 122, 149, 0.12)' : '#fbe8ec',
      colorErrorBorder: dark ? 'rgba(240, 122, 149, 0.35)' : '#efbfcb',
      fontFamily: "'Plus Jakarta Sans', 'Noto Sans Malayalam', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      borderRadius: 10,
      borderRadiusLG: 16,
      controlHeight: 40,
      wireframe: false,
    },
    components: {
      Layout: {
        bodyBg: dark ? '#0b1310' : '#f5f2ea',
        headerBg: 'transparent',
        siderBg: '#0b3d2f',
        footerBg: 'transparent',
        headerHeight: 64,
        headerPadding: '0 20px',
      },
      Menu: {
        darkItemBg: 'transparent',
        darkSubMenuItemBg: 'transparent',
        darkItemSelectedBg: 'rgba(255, 255, 255, 0.12)',
        darkItemSelectedColor: '#ffffff',
        darkItemColor: 'rgba(255, 255, 255, 0.72)',
        darkItemHoverColor: '#ffffff',
        darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
        itemBorderRadius: 10,
        itemHeight: 44,
        iconSize: 17,
      },
      Card: { borderRadiusLG: 16 },
      Button: { fontWeight: 600, primaryShadow: 'none' },
      Modal: { borderRadiusLG: 18 },
      Table: { headerBg: dark ? '#17241f' : '#faf8f2' },
    },
  };
}
