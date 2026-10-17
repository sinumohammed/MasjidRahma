import { Modal } from 'antd';
import InlineLoginForm from './InlineLoginForm';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

// Logging in: the welcome card (InlineLoginForm) in a pop-up, from the
// header, the phone's "Log in" tab or the invitation on the home page.
export default function AuthModal({ open, onClose }: AuthModalProps) {
  return (
    <Modal open={open} onCancel={onClose} footer={null} destroyOnHidden width={460} className="auth-modal" styles={{ body: { padding: 0 } }}>
      <InlineLoginForm onDone={onClose} />
    </Modal>
  );
}
