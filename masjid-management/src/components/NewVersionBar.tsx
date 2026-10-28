import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

// After a deploy the service worker has the new version, but this page still
// runs the old one. main.tsx fires NEW_VERSION_EVENT then; the bar offers a
// reload and never reloads by itself (a question or a form may be half done).
export const NEW_VERSION_EVENT = 'masjid-new-version';

export default function NewVersionBar() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const show = () => setReady(true);
    window.addEventListener(NEW_VERSION_EVENT, show);
    return () => window.removeEventListener(NEW_VERSION_EVENT, show);
  }, []);
  if (!ready) return null;
  return (
    <div className="new-version-bar" role="status">
      <span>A new version is ready · പുതിയ പതിപ്പ് തയ്യാർ</span>
      <Button size="small" type="primary" icon={<ReloadOutlined />} onClick={() => window.location.reload()}>
        Reload
      </Button>
      <Button size="small" type="text" onClick={() => setReady(false)} aria-label="Later">
        Later
      </Button>
    </div>
  );
}
