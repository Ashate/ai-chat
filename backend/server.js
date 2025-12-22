import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pdf from 'pdf-parse';
import * as xlsx from 'xlsx';
import unzipper from 'unzipper';

import { pool } from './db.js';
import { authRequired } from './authMiddleware.js';
import { MODEL_MAP } from './modelConfig.js';
import { callModelWithConfig, callVisionOpenAI } from './modelClients.js';

dotenv.config();

/**
 * =============================
 * 工具：错误/async handler
 * =============================
 */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// 兜底：不要再出现 curl: (52) Empty reply from server
process.on('unhandledRejection', (err) => {
  console.error('🔥 unhandledRejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('🔥 uncaughtException:', err);
});

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // 与 authMiddleware 保持一致：生产环境必须配置
  throw new Error('缺少 JWT_SECRET（请在 .env 或 docker-compose.yml 中设置）');
}

/**
 * =============================
 * App
 * =============================
 */
const app = express();
const PORT = Number(process.env.PORT || 4000);

// CORS：默认放开（反代同源时不会触发），如需白名单可设置 CORS_ORIGINS
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: corsOrigins.length ? corsOrigins : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// 画布/文件分析可能让消息体变大；提高 JSON 限制，避免大一点的请求直接 413/断开
app.use(express.json({ limit: '10mb' }));

/**
 * =============================
 * Canvas helpers
 * =============================
 */
const CANVAS_PREFIX = '__CANVAS__';

function safeParseCanvasSystem(content) {
  if (!content || typeof content !== 'string') return null;
  if (!content.startsWith(CANVAS_PREFIX)) return null;
  try {
    const json = content.slice(CANVAS_PREFIX.length);
    const obj = JSON.parse(json);
    if (obj && typeof obj.content === 'string') return obj;
  } catch {
    // ignore
  }
  return null;
}

function truncateForModel(str, maxChars = 12000) {
  if (!str) return '';
  const s = String(str);
  if (s.length <= maxChars) return s;
  return `...(为节省上下文，已截断，共 ${s.length} 字符)\n` + s.slice(s.length - maxChars);
}

/**
 * =============================
 * Uploads
 * =============================
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024 // 25MB
  }
});

// 仅用于解析 multipart/form-data 的纯表单字段（不包含文件）
// 让 /api/chats/:id/messages 同时支持 JSON 与 FormData 提交
const formParser = multer();

/**
 * =============================
 * 文件解析（带安全阈值）
 * =============================
 */
const MAX_ZIP_FILES = 200;
const MAX_ZIP_TOTAL_BYTES = 20 * 1024 * 1024; // 20MB

async function analyzeFileBuffer(fileName, buffer, depth = 0, zipState = { files: 0, bytes: 0 }) {
  if (depth > 3) return `\n[深度超过限制，略过: ${fileName}]\n`;

  const ext = path.extname(fileName).toLowerCase();

  if (ext === '.zip') {
    let out = `\n【ZIP 压缩包: ${fileName}】\n`;
    const directory = await unzipper.Open.buffer(buffer);

    for (const f of directory.files) {
      if (f.type !== 'File') continue;

      zipState.files += 1;
      if (zipState.files > MAX_ZIP_FILES) {
        out += `\n[ZIP 文件数超过限制（>${MAX_ZIP_FILES}），停止解析]\n`;
        break;
      }

      const childBuf = await f.buffer();
      zipState.bytes += childBuf.length;
      if (zipState.bytes > MAX_ZIP_TOTAL_BYTES) {
        out += `\n[ZIP 解压总字节超过限制（>${MAX_ZIP_TOTAL_BYTES}），停止解析]\n`;
        break;
      }

      out += `\n---\n[${f.path}]\n`;
      out += await analyzeFileBuffer(f.path, childBuf, depth + 1, zipState);
    }
    return out;
  }

  if (['.txt', '.md', '.json', '.log', '.csv'].includes(ext)) {
    return `\n[文本文件: ${fileName}]\n${buffer.toString('utf8')}\n`;
  }

  if (ext === '.pdf') {
    const data = await pdf(buffer);
    return `\n[PDF 文件: ${fileName}]\n${data.text}\n`;
  }

  if (ext === '.xlsx') {
    const wb = xlsx.read(buffer);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = xlsx.utils.sheet_to_json(sheet);
    return `\n[Excel 文件: ${fileName}]\n${JSON.stringify(json, null, 2)}\n`;
  }

  // 图片：走 OpenAI Vision（可选）
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    const mimeType = ext === '.jpg' ? 'image/jpeg' : `image/${ext.replace('.', '')}`;
    try {
      const vision = await callVisionOpenAI(buffer, mimeType);
      return `\n[图片文件: ${fileName}]\n${vision}\n`;
    } catch (e) {
      return `\n[图片文件: ${fileName}]\n[图片解析失败：${String(e?.message || e)}]\n`;
    }
  }

  // 兜底：尽量转为文本
  try {
    return `\n[文件: ${fileName}]\n${buffer.toString('utf8')}\n`;
  } catch {
    return `\n[文件: ${fileName}]\n[二进制内容，未解析]\n`;
  }
}

/**
 * =============================
 * 权限校验：会话归属
 * =============================
 */
async function assertChatOwned(chatId, userId) {
  const [rows] = await pool.query(
    'SELECT id FROM chat_sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [chatId, userId]
  );
  if (!rows.length) throw new HttpError(404, '会话不存在或无权限访问');
}

/**
 * =============================
 * Auth
 * =============================
 */
app.post(
  '/api/auth/register',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) throw new HttpError(400, '邮箱和密码必填');

    const [rows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (rows.length) throw new HttpError(400, '邮箱已注册');

    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, hash]);

    res.json({ success: true });
  })
);

app.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) throw new HttpError(400, '邮箱和密码必填');

    const [rows] = await pool.query(
      'SELECT id, password_hash FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    if (!rows.length) throw new HttpError(400, '邮箱或密码错误');

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new HttpError(400, '邮箱或密码错误');

    const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
  })
);

/**
 * =============================
 * Chats
 * =============================
 */
app.get(
  '/api/chats',
  authRequired,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT id, title, model_id, created_at, updated_at FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC',
      [req.user.id]
    );
    res.json(rows);
  })
);

app.post(
  '/api/chats',
  authRequired,
  asyncHandler(async (req, res) => {
    const { title, modelId } = req.body || {};

    const model_id = modelId || 'gpt-5-mini';

    const [r] = await pool.query(
      'INSERT INTO chat_sessions (user_id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      [req.user.id, title || '新对话', model_id]
    );

    res.json({ id: r.insertId });
  })
);

app.post(
  '/api/chats/:id/rename',
  authRequired,
  asyncHandler(async (req, res) => {
    const chatId = Number(req.params.id);
    const { title } = req.body || {};
    if (!chatId) throw new HttpError(400, '无效的会话 ID');
    if (!title || !title.trim()) throw new HttpError(400, '标题不能为空');

    await assertChatOwned(chatId, req.user.id);

    await pool.query(
      'UPDATE chat_sessions SET title = ?, updated_at = NOW() WHERE id = ? AND user_id = ?',
      [title.trim(), chatId, req.user.id]
    );

    res.json({ success: true });
  })
);

app.get(
  '/api/chats/:id/messages',
  authRequired,
  asyncHandler(async (req, res) => {
    const chatId = Number(req.params.id);
    if (!chatId) throw new HttpError(400, '无效的会话 ID');

    await assertChatOwned(chatId, req.user.id);

    const [rows] = await pool.query(
      'SELECT id, role, content, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC',
      [chatId]
    );

    res.json(rows);
  })
);

app.post(
  '/api/chats/:id/messages',
  authRequired,
  formParser.none(),
  asyncHandler(async (req, res) => {
    const chatId = Number(req.params.id);
    const {
      content,
      modelId,
      depthMode,
      outputTarget,
      canvasMode
    } = req.body || {};

    // 兼容字段名：fileIds（旧） / attachedFileIds（新）
    const rawIds = (
      Array.isArray(req.body?.fileIds)
        ? req.body.fileIds
        : Array.isArray(req.body?.attachedFileIds)
          ? req.body.attachedFileIds
          : typeof req.body?.fileIds === 'string'
            ? req.body.fileIds.split(',')
            : typeof req.body?.attachedFileIds === 'string'
              ? req.body.attachedFileIds.split(',')
              : (req.body?.fileIds != null ? [req.body.fileIds] : req.body?.attachedFileIds != null ? [req.body.attachedFileIds] : [])
    );
    const fileIds = [...new Set(rawIds.map(Number).filter(n => Number.isFinite(n) && n > 0))].slice(0, 20);

    if (!chatId) throw new HttpError(400, '无效的会话 ID');
    const hasText = !!(content && String(content).trim());
    if (!hasText && fileIds.length === 0) throw new HttpError(400, '内容不能为空');

    await assertChatOwned(chatId, req.user.id);

    const config = MODEL_MAP[modelId] || MODEL_MAP['gpt-5-mini'];
    if (!config) throw new HttpError(400, `未知模型 ID: ${modelId}`);

    const target = outputTarget === 'canvas' ? 'canvas' : 'chat';
    const wantNewCanvas = canvasMode === 'new';

    // 文件附件：输入框先上传缓存，发送时再绑定到对话
    let fileRows = [];
    if (fileIds.length) {
      const placeholders = fileIds.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT id, original_name, analysis_text, chat_id FROM uploaded_files WHERE user_id = ? AND id IN (${placeholders})`,
        [req.user.id, ...fileIds]
      );
      fileRows = rows || [];
      if (fileRows.length === 0) throw new HttpError(400, '附件不存在或无权限');
      // 不允许把已绑定到其他会话的附件拿来用
      const bad = fileRows.find(f => f.chat_id && Number(f.chat_id) !== chatId);
      if (bad) throw new HttpError(400, '附件已绑定到其他对话');
    }

    const fileNames = fileRows.map(f => f.original_name).filter(Boolean);
    const textInput = hasText ? String(content).trim() : '';
    const userContent = (textInput || '') + (fileNames.length ? `\n\n📎 附件：${fileNames.join(', ')}` : '');
    const userContentToSave = userContent.trim() || (fileNames.length ? `📎 附件：${fileNames.join(', ')}` : '');

// 1) 写入用户消息
    await pool.query(
      'INSERT INTO messages (chat_id, role, content, created_at) VALUES (?, ?, ?, NOW())',
      [chatId, 'user', userContentToSave]
    );


    // 1.05) 自动生成标题：仅在该会话首条用户消息时（避免全部显示“新对话”）
    try {
      const [sessRows] = await pool.query(
        'SELECT title FROM chat_sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [chatId, req.user.id]
      );
      const curTitle = (sessRows?.[0]?.title || '').trim();

      const [cntRows] = await pool.query(
        "SELECT COUNT(*) AS c FROM messages WHERE chat_id = ? AND role = 'user'",
        [chatId]
      );
      const userMsgCount = Number(cntRows?.[0]?.c || 0);

      // 只在首条用户消息时写标题；且只覆盖空标题/默认标题
      if (userMsgCount === 1 && (!curTitle || curTitle === '新对话')) {
        const base = (textInput || (fileNames.length ? `附件：${fileNames.join(', ')}` : '') || '').toString();
        const title = base.replace(/\s+/g, ' ').trim().slice(0, 32) || '新对话';
        await pool.query(
          'UPDATE chat_sessions SET title = ?, updated_at = NOW() WHERE id = ? AND user_id = ?',
          [title, chatId, req.user.id]
        );
      }
    } catch (e) {
      // 自动标题失败不影响对话
      console.warn('[auto-title] failed:', e?.message || e);
    }


    // 1.1) 若有附件，将解析结果写入 system（前端会过滤 system，不会显示）
    if (fileRows.length) {
      for (const f of fileRows) {
        // 只在首次绑定时写入 system，避免重复刷屏/膨胀
        if (f.chat_id) continue;
        const sys = `【附件解析｜${f.original_name}】\n${truncateForModel(String(f.analysis_text || ''), 12000)}`;
        await pool.query(
          'INSERT INTO messages (chat_id, role, content, created_at) VALUES (?, ?, ?, NOW())',
          [chatId, 'system', sys]
        );
      }

      const ids = fileRows.map(f => f.id);
      const placeholders = ids.map(() => '?').join(',');
      await pool.query(
        `UPDATE uploaded_files SET chat_id = ? WHERE user_id = ? AND id IN (${placeholders}) AND chat_id IS NULL`,
        [chatId, req.user.id, ...ids]
      );
    }

    // 2) 拉取上下文
    const [rows] = await pool.query(
      'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC',
      [chatId]
    );

    // 2.1) 若是画布模式：从历史里找最近一次画布（用于追加）
    let existingCanvas = null;
    if (target === 'canvas' && !wantNewCanvas) {
      const [crows] = await pool.query(
        "SELECT content FROM messages WHERE chat_id = ? AND role = 'system' AND content LIKE '__CANVAS__%' ORDER BY created_at DESC LIMIT 1",
        [chatId]
      );
      if (crows && crows.length > 0) {
        existingCanvas = safeParseCanvasSystem(String(crows[0].content || ''));
      }
    }

    const canvasTitle = (existingCanvas && existingCanvas.title) ? String(existingCanvas.title) : '画布';

    // 注意：画布会以 system 消息（__CANVAS__JSON）持久化，这类内部消息不能再喂回模型，
    // 否则上下文会膨胀到非常大，容易导致模型调用变慢/超时/网关 502。
    const messagesForModel = rows
      .filter(r => !(r.role === 'system' && typeof r.content === 'string' && r.content.startsWith(CANVAS_PREFIX)))
      .map(r => ({ role: r.role, content: r.content }));

    if (target === 'canvas') {
      if (existingCanvas && existingCanvas.content && !wantNewCanvas) {
        messagesForModel.push({
          role: 'system',
          content: `【当前画布内容（可续写）】
${truncateForModel(String(existingCanvas.content), 12000)}

---
请在不重复以上内容的前提下，继续写入新的内容。`
        });
      }
      messagesForModel.push({
        role: 'system',
        content: `你现在处于【画布模式】。你的输出将写入画布。
要求：
1) 只输出需要写入画布的正文内容（可以包含代码块/Markdown）。
2) 不要输出寒暄、解释、步骤编号或“已完成”等提示语。
3) 如果用户要求“新建画布”，则忽略旧内容重新开始。`
      });
    }

    // 3) 调模型
    const result = await callModelWithConfig(config, messagesForModel, {
      depthMode: !!depthMode,
      webSearch: true,
      outputTarget: target,
      canvasTitle
    });

    let replyText = '';
    let canvas = null;

    if (typeof result === 'string') {
      replyText = result;
    } else {
      replyText = result.text || '';
      canvas = result.canvas || null;
    }

    // 3.1) 画布模式：把本次产出写入画布（追加或新建），并持久化到消息表
    if (target === 'canvas') {
      const chunk = (canvas && canvas.content) ? String(canvas.content) : String(replyText || '');
      const base = (!wantNewCanvas && existingCanvas && existingCanvas.content) ? String(existingCanvas.content) : '';

      const merged = base ? (base + '\n\n' + chunk).trim() : chunk.trim();

      const canvasObj = {
        id: (existingCanvas && existingCanvas.id && !wantNewCanvas) ? String(existingCanvas.id) : crypto.randomUUID(),
        title: canvasTitle,
        content: merged,
        updatedAt: new Date().toISOString()
      };

      // 持久化画布（system 消息，前端可解析并重建）
      await pool.query(
        'INSERT INTO messages (chat_id, role, content, created_at) VALUES (?, ?, ?, NOW())',
        [chatId, 'system', CANVAS_PREFIX + JSON.stringify(canvasObj)]
      );

      canvas = canvasObj;

      // 画布模式下：assistant 文本提示保持极短（前端会优先展示画布）
      replyText = replyText && replyText.trim() ? replyText : '已写入画布';
    }

    // 4) 写入 assistant
    const [insertResult] = await pool.query(
      'INSERT INTO messages (chat_id, role, content, created_at) VALUES (?, ?, ?, NOW())',
      [chatId, 'assistant', replyText]
    );

    // 5) 更新会话时间
    await pool.query('UPDATE chat_sessions SET updated_at = NOW() WHERE id = ? AND user_id = ?', [
      chatId,
      req.user.id
    ]);

    res.json({
      id: insertResult.insertId,
      role: 'assistant',
      content: replyText,
      canvas
    });
  })
);

/**
 * =============================
 * Upload
 * =============================
 */
app.post(
  '/api/upload',
  authRequired,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, '未收到文件');

    const filePath = path.join(uploadsDir, req.file.filename);
    const buffer = fs.readFileSync(filePath);
    const analysisText = await analyzeFileBuffer(req.file.originalname, buffer, 0);

    const [result] = await pool.query(
      'INSERT INTO uploaded_files (user_id, chat_id, original_name, stored_name, mime_type, size, analysis_text, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?, NOW())',
      [
        req.user.id,
        req.file.originalname,
        req.file.filename,
        req.file.mimetype || '',
        Number(req.file.size || 0),
        String(analysisText || '')
      ]
    );

    res.json({
      success: true,
      fileId: result.insertId,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      analysisPreview: String(analysisText || '').slice(0, 3000)
    });
  })
);


app.delete(
  '/api/files/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const fileId = Number(req.params.id);
    if (!fileId) throw new HttpError(400, '无效的文件 ID');

    const [rows] = await pool.query(
      'SELECT id, stored_name, chat_id FROM uploaded_files WHERE id = ? AND user_id = ?',
      [fileId, req.user.id]
    );

    if (rows.length === 0) throw new HttpError(404, '文件不存在');
    if (rows[0].chat_id) throw new HttpError(400, '该文件已发送到对话，不能删除');

    await pool.query('DELETE FROM uploaded_files WHERE id = ? AND user_id = ?', [fileId, req.user.id]);

    const stored = rows[0].stored_name;
    if (stored) {
      try {
        fs.unlinkSync(path.join(uploadsDir, stored));
      } catch {
        // ignore
      }
    }

    res.json({ success: true });
  })
);

/**
 * =============================
 * Delete chat
 * =============================
 */
app.delete(
  '/api/chats/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const chatId = Number(req.params.id);
    if (!chatId) throw new HttpError(400, '无效的会话 ID');

    await assertChatOwned(chatId, req.user.id);

    // 先删 messages 再删 chat_sessions（确保无外键/历史脏表也能删干净）
    await pool.query('DELETE FROM messages WHERE chat_id = ?', [chatId]);
    await pool.query('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?', [chatId, req.user.id]);

    res.json({ success: true });
  })
);

/**
 * =============================
 * Health
 * =============================
 */
app.get('/', (req, res) => {
  res.send('AI Mobile Chat Backend Running');
});

/**
 * =============================
 * 404 + Error middleware
 * =============================
 */
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

app.use((err, req, res, next) => {
  console.error('🔥 Express error:', err);
  if (res.headersSent) return next(err);
  const status = err?.status || 500;
  res.status(status).json({ error: err?.message || '服务器错误' });
});

/**
 * =============================
 * Start
 * =============================
 */
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('Backend listening on port', PORT);
});

// 移动端/弱网：避免长请求被提前断开
server.keepAliveTimeout = 70_000;
server.headersTimeout = 75_000;

// Canvas/联网搜索/长文本生成时，模型请求可能 > 60s；避免 Node 自己提前超时断链。
server.requestTimeout = 0;
server.timeout = 0;
