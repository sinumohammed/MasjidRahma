import { useState, type RefObject } from 'react';
import { Tooltip, message } from 'antd';
import { CopyOutlined, PictureOutlined, PrinterOutlined, CheckOutlined } from '@ant-design/icons';
import { toPng } from 'html-to-image';
import { answerAsText, answerAsHtml } from './answerFormat';

// Under each assistant answer: copy it, save it as a picture, or print it
// (the print dialog's "Save as PDF" makes a PDF).
//   - Copy: plain text with tables tab-separated (they paste into a
//     spreadsheet as columns) plus HTML with a real table (Word, Gmail, Docs)
//   - Image: a PNG of the answer bubble, chart included; on a phone the share
//     sheet (WhatsApp...), else a download
//   - Print: a copy of the answer straight under <body>, everything else
//     hidden (AssistantChat.css) - the answer itself sits in a clipped,
//     scrolling panel that printed blank on a computer
const fileName = () => `masjid-assistant-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`;

export default function AnswerActions({ text, target }: { text: string; target: RefObject<HTMLDivElement | null> }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const copy = async () => {
    const plain = answerAsText(text);
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([plain], { type: 'text/plain' }),
            'text/html': new Blob([answerAsHtml(text)], { type: 'text/html' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      message.error('Could not copy - select the text and copy it instead');
    }
  };

  const saveImage = async () => {
    const el = target.current;
    if (!el) return;
    setBusy(true);
    try {
      // The bubble's own background, so the picture is readable in dark mode too.
      let bg = getComputedStyle(el).backgroundColor;
      if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = getComputedStyle(document.body).backgroundColor || '#ffffff';
      const dataUrl = await toPng(el, {
        pixelRatio: 2,
        // Google Fonts' stylesheet cannot be read cross-origin; the device's fonts are used.
        skipFonts: true,
        backgroundColor: bg,
        style: { margin: '0', maxWidth: 'none' },
        filter: (node) => !(node instanceof HTMLElement && node.dataset.noCapture === 'true'),
      });
      const name = `${fileName()}.png`;
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Masjid assistant' });
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          // sharing refused: download instead
        }
      }
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = name;
      a.click();
    } catch {
      message.error('Could not make the picture');
    } finally {
      setBusy(false);
    }
  };

  // The copy is not removed on "afterprint": phones return from print() at
  // once and some say "printed" before the page is drawn. It goes at the next
  // tap after printing - before anything else (a receipt) can be printed.
  const print = () => {
    const el = target.current;
    if (!el) return;
    document.querySelectorAll('.m-print-holder').forEach((old) => old.remove());
    // .assistant-shell carries the chat's colours (--a-*).
    const holder = document.createElement('div');
    holder.className = 'assistant-shell m-print-holder';
    holder.appendChild(el.cloneNode(true));
    document.body.appendChild(holder);
    document.body.classList.add('m-print-answer');
    window.print();
    setTimeout(() => {
      window.addEventListener(
        'pointerdown',
        () => {
          holder.remove();
          document.body.classList.remove('m-print-answer');
        },
        { once: true, capture: true }
      );
    }, 0);
  };

  return (
    <div className="assistant-answer-actions" data-no-capture="true">
      <Tooltip title={copied ? 'Copied' : 'Copy'}>
        <button type="button" onClick={copy} aria-label="Copy the answer">
          {copied ? <CheckOutlined /> : <CopyOutlined />}
        </button>
      </Tooltip>
      <Tooltip title="Save as image">
        <button type="button" onClick={saveImage} disabled={busy} aria-label="Save the answer as an image">
          <PictureOutlined />
        </button>
      </Tooltip>
      <Tooltip title="Print or save as PDF">
        <button type="button" onClick={print} aria-label="Print the answer or save it as PDF">
          <PrinterOutlined />
        </button>
      </Tooltip>
    </div>
  );
}
