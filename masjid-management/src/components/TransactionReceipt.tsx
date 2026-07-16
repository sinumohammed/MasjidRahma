import dayjs from 'dayjs';
import { Button } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import type { Transaction, Member } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import './TransactionReceipt.css';

interface TransactionReceiptProps {
  transaction: Transaction;
  member?: Member;
}

function receiptNumber(transaction: Transaction) {
  return `RCPT-${transaction.id.slice(0, 8).toUpperCase()}`;
}

export default function TransactionReceipt({ transaction, member }: TransactionReceiptProps) {
  const { currencySymbol } = useSettings();

  return (
    <div className="receipt-print-area">
      <div className="receipt-toolbar">
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
          Print / Save as PDF
        </Button>
      </div>

      <div className="receipt-paper">
        <div className="receipt-header">
          <div className="receipt-masjid-name">🕌 Masjid Rahma</div>
          <div className="receipt-subtitle">Payment Receipt</div>
        </div>

        <div className="receipt-meta">
          <div>
            <span className="receipt-meta-label">Receipt No.</span>
            <span className="receipt-meta-value">{receiptNumber(transaction)}</span>
          </div>
          <div>
            <span className="receipt-meta-label">Date</span>
            <span className="receipt-meta-value">{dayjs(transaction.date).format('DD MMM YYYY')}</span>
          </div>
        </div>

        <div className="receipt-divider" />

        <div className="receipt-row">
          <span className="receipt-row-label">Received From</span>
          <span className="receipt-row-value">
            {member ? `${member.name} (${member.unique_id})` : 'General Donation'}
          </span>
        </div>
        <div className="receipt-row">
          <span className="receipt-row-label">Category</span>
          <span className="receipt-row-value">{transaction.category}</span>
        </div>
        {transaction.description && (
          <div className="receipt-row">
            <span className="receipt-row-label">Description</span>
            <span className="receipt-row-value">{transaction.description}</span>
          </div>
        )}

        <div className="receipt-divider" />

        <div className="receipt-amount-row">
          <span className="receipt-row-label">Amount Received</span>
          <span className="receipt-amount-value">
            {currencySymbol}
            {transaction.amount.toFixed(2)}
          </span>
        </div>

        <div className="receipt-divider" />

        <div className="receipt-footer">
          <p>Jazakum Allahu Khairan for your generous contribution.</p>
          <p className="receipt-generated">Generated on {dayjs().format('DD MMM YYYY, h:mm A')}</p>
        </div>
      </div>
    </div>
  );
}
