import React, { useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import type { CanvasData } from '../types';

type Props = {
  open: boolean;
  canvas: CanvasData | null;
  onChange: (next: CanvasData) => void;
  onClose: () => void;
  initialEditing?: boolean;
};

function sanitizeFileName(name: string) {
  return (name || 'canvas')
    .trim()
    .replace(/[\\/:*?\"<>|]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'canvas';
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 某些移动端浏览器需要一点时间才能开始下载，立刻 revoke 会导致“点了没反应”
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Clipboard 在 http(非 localhost) 上经常不可用：提供一个兼容回退
async function copyTextCompat(text: string) {
  // 1) 现代 API（可能要求 https / user gesture）
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // ignore
  }

  // 2) 旧回退：execCommand('copy')
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.setAttribute('readonly', 'true');
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export default function CanvasPanel({ open, canvas, onChange, onClose, initialEditing }: Props) {
  const [fullscreen, setFullscreen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const fileBase = useMemo(() => sanitizeFileName(canvas?.title || '画布'), [canvas?.title]);

  useEffect(() => {
    if (!open) return;
    // 打开时默认全屏（更接近 ChatGPT Canvas）
    setFullscreen(true);
    setEditing(!!initialEditing);
  }, [open, initialEditing]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(t);
  }, [toast]);

  if (!open || !canvas) return null;

  const copyAll = async () => {
    const ok = await copyTextCompat(canvas.content || '');
    setToast(ok ? '已复制' : '复制失败');
  };

  const exportMd = () => {
    const blob = new Blob([canvas.content || ''], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(`${fileBase}.md`, blob);
  };

  const exportTxt = () => {
    const blob = new Blob([canvas.content || ''], { type: 'text/plain;charset=utf-8' });
    downloadBlob(`${fileBase}.txt`, blob);
  };

  // Word：用 HTML 包一层，保存为 .doc（Word 可直接打开）
  const exportWord = () => {
    const escaped = (canvas.content || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${fileBase}</title>
</head>
<body>
<pre style="white-space:pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 12pt;">${escaped}</pre>
</body>
</html>`;

    const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
    downloadBlob(`${fileBase}.doc`, blob);
  };

  // PDF：直接打开打印对话框，用户可“另存为 PDF”（浏览器通用做法）
  const exportPdf = () => {
    // 某些手机浏览器下载会“像没反应”，先给点反馈
    setToast('正在生成 PDF…');

    // ✅ 生成真正的 PDF 文件并触发下载（不再依赖浏览器“打印->另存为 PDF”）
    // 注意：jsPDF 默认字体对中文支持有限；代码/英文效果最佳。
    const doc = new jsPDF({
      unit: 'pt',
      format: 'a4',
      compress: true
    });

    // 使用等宽字体更适合代码（内置字体）
    doc.setFont('courier', 'normal');
    doc.setFontSize(10);

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const marginX = 40;
    const marginY = 50;
    const lineHeight = 14;

    // 标题
    const pdfTitle = (canvas.title || '').trim();
    if (pdfTitle) {
      doc.setFontSize(14);
      doc.text(pdfTitle, marginX, marginY);
      doc.setFontSize(10);
    }

    // 内容从标题下方开始
    let cursorY = marginY + 24;

    const content = (canvas.content || '').replace(/\r\n/g, '\n');
    const lines = content.split('\n');

    const maxTextWidth = pageWidth - marginX * 2;

    const pushLine = (line: string) => {
      // jsPDF 自带换行分割
      const wrapped = doc.splitTextToSize(line, maxTextWidth) as string[];
      for (const w of wrapped) {
        if (cursorY > pageHeight - marginY) {
          doc.addPage();
          cursorY = marginY;
        }
        doc.text(w, marginX, cursorY);
        cursorY += lineHeight;
      }
    };

    for (const line of lines) {
      // 空行也要占位
      if (!line) {
        if (cursorY > pageHeight - marginY) {
          doc.addPage();
          cursorY = marginY;
        }
        cursorY += lineHeight;
        continue;
      }
      pushLine(line);
    }

    try {
      const blob = doc.output('blob');
      downloadBlob(`${fileBase}.pdf`, blob);
      setToast('已开始下载');
    } catch (err) {
      // 回退：有些环境不支持 output('blob')
      doc.save(`${fileBase}.pdf`);
      setToast('已开始下载');
    }
  };

  return (
    <div
      className="canvas-overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        // 点击遮罩关闭（更像官网），但不影响面板内部点击
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className={'canvas-card ' + (fullscreen ? 'fullscreen' : '')}
      >
        <div className="canvas-toolbar">
          <div className="canvas-toolbar-left">
            <button className="cbtn ghost" onClick={onClose}>返回</button>
            <div className="canvas-pill">Canvas</div>
            <input
              className="canvas-title"
              value={canvas.title}
              onChange={e => onChange({ ...canvas, title: e.target.value })}
              placeholder="画布标题"
            />
          </div>

          <div className="canvas-toolbar-right">
            <button className={'cbtn ' + (editing ? 'on' : '')} onClick={() => setEditing(v => !v)}>
              {editing ? '预览' : '编辑'}
            </button>

            <button className="cbtn" onClick={() => setFullscreen(v => !v)}>
              {fullscreen ? '退出全屏' : '全屏'}
            </button>

            <button className="cbtn" onClick={copyAll}>复制</button>

            <details className="cmenu">
              <summary className="cbtn">下载 ▾</summary>
              <div className="cmenupop">
                <button type="button" onClick={exportMd}>Markdown (.md)</button>
                <button type="button" onClick={exportWord}>Word (.doc)</button>
                <button type="button" onClick={exportTxt}>TXT (.txt)</button>
                <button type="button" onClick={exportPdf}>PDF (.pdf)</button>
              </div>
            </details>

            <button className="cbtn danger" onClick={onClose}>关闭</button>
          </div>
        </div>

        <div className="canvas-body">
          {editing ? (
            <textarea
              className="canvas-editor"
              value={canvas.content}
              onChange={e => onChange({ ...canvas, content: e.target.value })}
              placeholder="这里是画布内容…"
            />
          ) : (
            <div className="canvas-preview">
              <pre>{canvas.content}</pre>
            </div>
          )}
        </div>

        {toast && <div className="toast toast-floating">{toast}</div>}
      </div>
    </div>
  );
}