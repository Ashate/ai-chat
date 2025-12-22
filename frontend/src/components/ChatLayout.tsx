import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { apiRequest, apiUploadTempFile, apiDeleteTempFile } from '../api';
import type { CanvasData, ChatMessage, ChatSession } from '../types';
import { MODELS, DEFAULT_MODEL_ID } from '../constants';
import MarkdownView from './MarkdownView';
import CanvasPanel from './CanvasPanel';

function uuid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

type PendingFile = {
  id: number;
  name: string;
  size: number;
  mimeType?: string | null;
};


async function deleteChat(id: number, token: string) {
  return apiRequest(`/chats/${id}`, { method: 'DELETE' }, token);
}

const CANVAS_PREFIX = '__CANVAS__';

function safeParseCanvas(content: string): CanvasData | null {
  if (!content?.startsWith(CANVAS_PREFIX)) return null;
  try {
    const json = content.slice(CANVAS_PREFIX.length);
    const obj = JSON.parse(json);
    if (obj && typeof obj.content === 'string') {
      return {
        id: obj.id,
        title: String(obj.title || '画布'),
        content: String(obj.content || '')
      };
    }
  } catch {
    // ignore
  }
  return null;
}

function extractLatestCanvas(messages: any[]): CanvasData | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'system' && typeof m?.content === 'string' && m.content.startsWith(CANVAS_PREFIX)) {
      const c = safeParseCanvas(m.content);
      if (c) return c;
    }
  }
  return null;
}

// Clipboard 在 http(非 localhost) 上经常不可用：提供回退
async function copyToClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // ignore
  }

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

// ---------- EditableTitle ----------
const EditableTitle: React.FC<{
  session: ChatSession;
  token: string;
  onRename: () => void;
}> = ({ session, token, onRename }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(session.title);

  const save = async () => {
    if (!value.trim()) {
      setEditing(false);
      return;
    }
    try {
      await apiRequest(
        `/chats/${session.id}/rename`,
        {
          method: 'POST',
          body: JSON.stringify({ title: value.trim() })
        },
        token
      );
      onRename();
    } catch {
      // ignore
    } finally {
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        className="sidebar-title-edit"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={e => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        autoFocus
      />
    );
  }

  return (
    <div
      className="sidebar-chat-title"
      onClick={e => {
        e.stopPropagation();
        setEditing(true);
      }}
      title="点击重命名"
    >
      {session.title}
    </div>
  );
};

const ChatLayout: React.FC = () => {
  const { token, email, logout } = useAuth();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [modelId, setModelId] = useState<string>(DEFAULT_MODEL_ID);
  const [depthMode, setDepthMode] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);

  // 📱移动端：侧边栏默认收起，顶部按钮可打开
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 900px)').matches;
  });

  // ✅ GPT 官网风格：选择“画布模式”后，后续输出写入画布
  const [outputMode, setOutputMode] = useState<'chat' | 'canvas'>('chat');
  const [canvas, setCanvas] = useState<CanvasData | null>(null);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasOpenEditing, setCanvasOpenEditing] = useState(false);
  const [newCanvasNext, setNewCanvasNext] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const currentModel = useMemo(
    () => MODELS.find(m => m.id === modelId) ?? MODELS[0],
    [modelId]
  );

  const showToast = (t: string) => {
    setToast(t);
    window.clearTimeout((showToast as any)._tid);
    (showToast as any)._tid = window.setTimeout(() => setToast(null), 1800);
  };

  const loadSessions = async () => {
    if (!token) return;
    const data = await apiRequest('/chats', {}, token);
    setSessions(data);

    if (currentSessionId && !data.find((s: any) => s.id === currentSessionId)) {
      setCurrentSessionId(null);
      setMessages([]);
      setCanvas(null);
    }

    if (data.length > 0 && currentSessionId == null) {
      setCurrentSessionId(data[0].id);
    }
  };

  const loadMessages = async (chatId: number) => {
    if (!token) return;
    const data = await apiRequest(`/chats/${chatId}/messages`, {}, token);

    // 从历史消息中恢复画布（后端用 __CANVAS__system message 持久化）
    const latestCanvas = extractLatestCanvas(data);
    setCanvas(latestCanvas);

    // UI 不显示 system 消息（避免把内部上下文/画布标记暴露给用户）
    const visible = (data as ChatMessage[]).filter(m => m.role !== 'system');
    setMessages(visible);
  };

  useEffect(() => {
    if (token) {
      loadSessions().catch(console.error);
    }
  }, [token]);

  useEffect(() => {
    if (token && currentSessionId != null) {
      loadMessages(currentSessionId).catch(console.error);
    } else {
      setMessages([]);
      setCanvas(null);
    }
  }, [token, currentSessionId]);

  const handleNewChat = async () => {
    if (!token) return;
    const data = await apiRequest(
      '/chats',
      {
        method: 'POST',
        body: JSON.stringify({ title: '新对话', modelId })
      },
      token
    );
    await loadSessions();
    setCurrentSessionId(data.id);
    setMessages([]);
    setCanvas(null);
  };

  const handleDeleteChat = async (chatId: number) => {
    if (!token) return;
    if (!confirm('确定要删除这个对话吗？')) return;
    await deleteChat(chatId, token);
    await loadSessions();
  };

  const handleSend = async () => {
    if (!token || !currentSessionId) return;

    if (uploading) {
      showToast('文件正在上传中，请稍后再发送');
      return;
    }

    const rawText = input.trim();
    const attachedFileIds = pendingFiles.map((f) => f.id).filter(Boolean);
    const hasFiles = attachedFileIds.length > 0;
    const hasText = rawText.length > 0;

    // 允许只发文件（不发文字）
    if (!hasText && !hasFiles) return;

    let text = rawText;
    if (!text && hasFiles) {
      text = '请分析我上传的文件。';
    }
    setInput('');

    const userDisplay = hasText
      ? rawText
      : `📎 已发送文件：${pendingFiles.map((f) => f.name).join(', ')}`;
    const tempUser: ChatMessage = { id: uuid(), role: 'user', content: userDisplay };
    setMessages(prev => [...prev, tempUser]);
    setSending(true);

    try {
      let outTarget: 'chat' | 'canvas' = outputMode;
      let canvasMode: 'append' | 'new' | undefined;

      if (outTarget === 'canvas') {
        // ✅ 规则：默认追加；只有明确“新建画布”/点击按钮才新建
        canvasMode = newCanvasNext ? 'new' : 'append';

        // 口令式触发（可选）：以“新建画布/新画布”开头时，当作新建
        const m = text.trim();
        const m2 = m.replace(/^\s+/, '');
        const hit = /^(新建画布|新画布|重新新建画布|重新开画布)([:：\s]|$)/.exec(m2);
        if (hit) {
          canvasMode = 'new';
          text = m2.replace(/^(新建画布|新画布|重新新建画布|重新开画布)([:：\s])?/, '').trim();
          if (!text) text = m2; // 避免误删导致空内容
        }
      }

      const data = await apiRequest(
        `/chats/${currentSessionId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            content: text,
            modelId,
            depthMode,
            outputTarget: outTarget,
            canvasMode,
            // 后端当前字段为 fileIds（同时兼容 attachedFileIds）
            fileIds: attachedFileIds
          })
        },
        token
      );

      // 1) 先把 assistant 文本消息追加到聊天（即使画布模式，也保留一个简短提示）
      const assistant: ChatMessage = {
        id: data.id ?? uuid(),
        role: 'assistant',
        content: data.content || ''
      };

      setMessages(prev => [...prev.filter(m => m.id !== tempUser.id), tempUser, assistant]);
      loadSessions().catch(() => {});

      // 2) 若后端返回 canvas，则更新画布（不会清空历史，除非 canvasMode=new）
      if (data?.canvas?.content) {
        const c: CanvasData = {
          id: data.canvas.id,
          title: data.canvas.title || '画布',
          content: data.canvas.content
        };
        setCanvas(c);

        // GPT 官网风格：如果当前就在画布模式，就让用户明显感知
        if (outTarget === 'canvas') {
          showToast(canvasMode === 'new' ? '已新建画布' : '已更新画布');
        }
      }

      setNewCanvasNext(false);
      // 发送成功后清空输入框缓存的文件（文件已随消息一起提交）
      setPendingFiles([]);
    } catch (e: any) {
      const errMsg: ChatMessage = {
        id: uuid(),
        role: 'assistant',
        content: '发送失败：' + (e.message || String(e))
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  
const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
  const file = e.target.files?.[0];
  // 允许重复选择同一个文件
  e.target.value = '';

  if (!file) return;
  if (!token || !currentSessionId) {
    addAssistantMessage('请先登录并创建/选择一个会话后再上传文件。');
    return;
  }

  setUploading(true);
  try {
    const data = await apiUploadTempFile(file, token);
    const fileId = Number(data.fileId || data.id);
    if (!fileId) throw new Error('上传成功但未返回 fileId');

    setPendingFiles((prev) => [
      ...prev,
      {
        id: fileId,
        name: data.originalName || file.name,
        size: Number(data.size || file.size || 0),
        mimeType: data.mimeType || file.type || null
      }
    ]);

    // ChatGPT 风格：上传后只是“挂在输入框”，不自动插入一条分析消息
    // 用户点击发送时，才会把 fileIds 一起发送给模型
  } catch (err: any) {
    addAssistantMessage('文件上传失败：' + (err?.message || String(err)));
  } finally {
    setUploading(false);
  }
};

const removePendingFile = async (fileId: number) => {
  setPendingFiles((prev) => prev.filter((f) => f.id !== fileId));
  try {
    if (token) await apiDeleteTempFile(fileId, token);
  } catch {
    // 删除失败不阻塞 UI
  }
};


  const renderCanvasInline = () => {
    if (!canvas?.content?.trim()) return null;

    return (
      <div className="msg-row assistant">
        <div className="canvas-inline">
          <div className="canvas-inline-top">
            <div className="canvas-inline-title">
              <span className="canvas-badge">画布</span>
              <span className="canvas-title-text">{canvas.title || '画布'}</span>
            </div>

            <div className="canvas-inline-actions">
              <button
                className="icon-btn"
                title="复制"
                onClick={async () => {
                  const ok = await copyToClipboard(canvas.content);
                  showToast(ok ? '已复制' : '复制失败');
                }}
              >
                复制
              </button>

              <button
                className="icon-btn"
                title="打开编辑"
                onClick={() => {
                  setCanvasOpenEditing(true);
                  setCanvasOpen(true);
                }}
              >
                编辑
              </button>

              <button
                className="icon-btn"
                title="全屏"
                onClick={() => {
                  setCanvasOpenEditing(false);
                  setCanvasOpen(true);
                }}
              >
                全屏
              </button>
            </div>
          </div>

          <div
            className="canvas-inline-body"
            onClick={() => {
              setCanvasOpenEditing(false);
              setCanvasOpen(true);
            }}
          >
            <MarkdownView content={canvas.content} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="app-root">
      <div className={"sidebar-backdrop" + (sidebarOpen ? " show" : "")} onClick={() => setSidebarOpen(false)} />
      <aside className={"sidebar" + (sidebarOpen ? " open" : "")}>
        <div className="sidebar-header">
          <div className="sidebar-title">对话</div>
          <button className="sidebar-newchat" onClick={handleNewChat}>
            新建对话
          </button>
        </div>
        <div className="sidebar-user">
          <span>{email}</span>
          <button onClick={logout}>退出</button>
        </div>

        <div className="sidebar-list">
          {sessions.map(s => (
            <div
              key={s.id}
              className={
                'sidebar-chat-item' + (currentSessionId === s.id ? ' active' : '')
              }
            >
              <button
                className="sidebar-chat-main"
                onClick={() => setCurrentSessionId(s.id)}
              >
                <EditableTitle session={s} token={token!} onRename={loadSessions} />
                <div className="sidebar-chat-meta">
                  {new Date(s.updated_at).toLocaleString()}
                </div>
              </button>

              <button
                className="chat-delete-btn"
                onClick={e => {
                  e.stopPropagation();
                  handleDeleteChat(s.id);
                }}
              >
                🗑
              </button>
            </div>
          ))}

          {sessions.length === 0 && (
            <div className="sidebar-empty">暂无对话，点击上方“新建对话”开始</div>
          )}
        </div>
      </aside>

      <div className="chat-root">
        <header className="chat-header">
          <div className="chat-header-row">
            <button
              className="sidebar-toggle"
              type="button"
              onClick={() => setSidebarOpen(v => !v)}
              aria-label={sidebarOpen ? '收起侧边栏' : '打开侧边栏'}
              title={sidebarOpen ? '收起侧边栏' : '打开侧边栏'}
            >
              ☰
            </button>

            <div className="chat-header-titles">
              <div className="chat-header-title">AI Mobile Chat</div>
              <div className="chat-header-sub">
                {currentModel.label}
                {outputMode === 'canvas' && (
                  <span className="canvas-mode-pill">在画布中写内容</span>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="chat-main">
          {messages.map(m => (
            <div
              key={m.id}
              className={m.role === 'user' ? 'msg-row user' : 'msg-row assistant'}
            >
              {m.role === 'user' ? (
                <div className="msg-bubble user">
                  <div className="msg-content">{m.content}</div>
                </div>
              ) : (
                <div className="msg-assistant-block">
                  <MarkdownView content={m.content} />
                </div>
              )}
            </div>
          ))}

          {renderCanvasInline()}

          {messages.length === 0 && !canvas?.content && (
            <div className="chat-empty">开始你的第一句对话吧～</div>
          )}
        </main>

        <footer className="chat-input-area">
          <div className="chat-input-top">
            <div className="model-select">
              <select value={modelId} onChange={e => setModelId(e.target.value)}>
                {MODELS.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <span className="triangle">▼</span>
            </div>

            <button
              className={'pill-toggle' + (depthMode ? ' on' : '')}
              onClick={() => setDepthMode(v => !v)}
              title="点击开启/关闭深度思考"
            >
              深度思考
            </button>

            <div className="canvas-toggle-wrap">
              <button
                className={'pill-toggle' + (outputMode === 'canvas' ? ' on' : '')}
                onClick={() => setOutputMode(m => (m === 'canvas' ? 'chat' : 'canvas'))}
                title="切换画布模式"
              >
                画布
              </button>

              <button
                className="pill-sub"
                onClick={() => {
                  setOutputMode('canvas');
                  setNewCanvasNext(true);
                  showToast('下一条将新建画布');
                }}
                title="下一条消息新建画布"
              >
                新建
              </button>

              {/* 不在输入栏放“打开”按钮：避免误解（用户可点消息区画布或右上按钮打开） */}
            </div>

            <label className="file-upload" title="上传文件">
              <input type="file" onChange={handleFileChange} disabled={uploading} />
              📎
            </label>
          </div>

          <div className="chat-input-bottom">
            
{pendingFiles.length > 0 && (
  <div className="chat-attachments">
    {pendingFiles.map((f) => (
      <div key={f.id} className="chat-attachment-pill" title={f.name}>
        <span className="chat-attachment-name">{f.name}</span>
        <button
          className="chat-attachment-remove"
          onClick={() => removePendingFile(f.id)}
          aria-label="移除附件"
          type="button"
        >
          ×
        </button>
      </div>
    ))}
  </div>
)}
<textarea
              className="chat-textarea"
              placeholder="输入内容，Enter 发送，Shift+Enter 换行"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />

            <button
              className="chat-send-btn"
              onClick={handleSend}
              disabled={sending || uploading || ((!input.trim()) && pendingFiles.length === 0) || !currentSessionId}
            >
              {sending ? '思考中…' : uploading ? '上传中…' : '发送'}
            </button>
          </div>

          {toast && <div className="toast">{toast}</div>}
        </footer>
      </div>

      <CanvasPanel
        open={canvasOpen}
        canvas={canvas}
        initialEditing={canvasOpenEditing}
        onChange={(next) => setCanvas(next)}
        onClose={() => {
          setCanvasOpen(false);
          setCanvasOpenEditing(false);
        }}
      />
    </div>
  );
};

export default ChatLayout;
