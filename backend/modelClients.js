// backend/modelClients.js
import dotenv from "dotenv";
dotenv.config();

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEEPSEEK_BASE =
  process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/chat/completions";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/* ================= 工具函数 ================= */

/** 从 OpenAI Responses API 中提取文本 */
function extractTextFromResponse(json) {
  const outputs = json.output || [];
  let text = "";

  for (const item of outputs) {
    if (item.type === "message") {
      const part = item.content?.find(p => p.type === "output_text");
      if (part?.text) text += part.text;
    }
  }

  return text.trim();
}

/* ============= 画布 ============= */

function extractTextAndCanvas(json) {
  const result = {
    text: "",
    canvas: null
  };

  const outputs = json.output || [];

  for (const item of outputs) {
    // 普通文本
    if (item.type === "message") {
      const part = item.content?.find(p => p.type === "output_text");
      if (part?.text) result.text += part.text;
    }

    // 🎨 Canvas
    if (item.type === "canvas") {
      result.canvas = {
        title: item.title || "未命名画布",
        content: item.content || ""
      };
    }
  }

  return result;
}

/** 通用超时 fetch（移动端/弱网必备） */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

function isRetryableError(err) {
  const msg = String(err?.message || err);
  return (
    msg.includes("AbortError") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("EAI_AGAIN")
  );
}

/** 超时 + 重试（指数退避） */
async function fetchWithRetry(url, options = {}, cfg = {}) {
  const {
    timeoutMs = 60000,
    retries = 2,
    baseDelayMs = 600,
    maxDelayMs = 2500
  } = cfg;

  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...options, signal: controller.signal });

      // 429/5xx：可重试
      if (isRetryableStatus(res.status) && attempt < retries) {
        const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
        await sleep(delay);
        continue;
      }

      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries && isRetryableError(err)) {
        const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
        await sleep(delay);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(id);
    }
  }

  throw lastErr;
}

/* ================= 新增一个能力驱动入口 ================= */

export async function callModelWithConfig(config, messages, options = {}) {
  const { provider, model, capabilities } = config;

  const depthMode = !!(options.depthMode && capabilities?.reasoning === true);
  const webSearch = !!(options.webSearch && capabilities?.webSearch === true);
  const outputTarget = options.outputTarget || "chat"; // "chat" | "canvas"
  const canvasTitle = options.canvasTitle || "画布";

  try {
    let raw;

    if (provider === "openai") {
      raw = await callOpenAI(model, messages, {
        depthMode,
        webSearch,
        outputTarget
      });
    } else if (provider === "deepseek") {
      raw = await callDeepSeek(model, messages, depthMode);
    } else if (provider === "gemini") {
      raw = await callGemini(model, messages, depthMode);
    } else {
      throw new Error("未知 provider: " + provider);
    }

    // 统一形态：当 outputTarget=canvas 时，保证返回 { text, canvas }
    if (outputTarget === "canvas") {
      if (typeof raw === "string") {
        return { text: "", canvas: { title: canvasTitle, content: raw } };
      }
      if (raw && typeof raw === "object") {
        if (raw.canvas && (raw.canvas.content || raw.canvas.title)) return raw;
        const t = raw.text || "";
        return { text: "", canvas: { title: canvasTitle, content: t } };
      }
      return { text: "", canvas: { title: canvasTitle, content: "" } };
    }

    return raw;
  } catch (err) {
    console.error(`[ModelError] ${provider}/${model}`, err);
    const msg = "⚠️ 当前模型暂时不可用，请稍后重试或切换模型。";
    if (outputTarget === "canvas") {
      return { text: "", canvas: { title: canvasTitle, content: msg } };
    }
    return msg;
  }
}

/* ================= OpenAI（GPT-5 / Vision） ================= */

async function callOpenAI(model, messages, options = {}) {
  const { depthMode, webSearch, outputTarget } = options;
  
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("缺少 OPENAI_API_KEY");

const CANVAS_SYSTEM_HINT = `
当你要输出以下类型内容时，请使用【Canvas 画布】而不是普通回复：
- 代码（任何语言）
- 教程 / 文档 / 方案说明
- 表格 / 清单 / 长文本（>30 行）
- 用户明确要求“整理”“生成文件”“写成文档”的内容

Canvas 要求：
- 有明确标题
- 内容结构清晰
- 只放最终结果，不要聊天语气
- 内容必须完整、可复制、可保存为文件
`;

  const finalMessages = (outputTarget === "canvas")
    ? ([{ role: "system", content: CANVAS_SYSTEM_HINT }, ...messages])
    : messages;
  
  // 将聊天消息拼成纯文本输入（Responses 推荐）
  const inputText = finalMessages
    .map(m => `${m.role}: ${m.content}`)
    .join("\n");

  const body = {
    model,
    input: inputText
  };

  // GPT-5 推理强度
  if (depthMode) {
    body.reasoning = { effort: "medium" };
  }

  // 🌐 OpenAI 联网搜索（能力 + options + env 三重判断）
  if (
    webSearch === true &&
    process.env.OPENAI_WEB_SEARCH === "1"
  ) {
    body.tools = [{ type: "web_search" }];
  }


  const res = await fetchWithRetry(
    OPENAI_RESPONSES_URL,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    },
    { timeoutMs: 60000, retries: 2 }
  );

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || "OpenAI Responses 调用失败");
  }

  return extractTextAndCanvas(json);
}

/** ✅ OpenAI Vision（统一 Responses API） */
export async function callVisionOpenAI(buffer, mimeType) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("缺少 OPENAI_API_KEY");

  const base64 = buffer.toString("base64");

  const body = {
    model: "gpt-5-mini",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "请用中文详细描述这张图片的内容和关键信息。" },
          {
            type: "input_image",
            image_base64: base64,
            mime_type: mimeType
          }
        ]
      }
    ]
  };

  const res = await fetchWithRetry(
    OPENAI_RESPONSES_URL,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    },
   { timeoutMs: 60000, retries: 2 }
  );

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || "OpenAI Vision 调用失败");
  }

  return extractTextFromResponse(json);
}

/* ================= DeepSeek ================= */

async function callDeepSeek(model, messages, depthMode) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("缺少 DEEPSEEK_API_KEY");

  const res = await fetchWithRetry(
    DEEPSEEK_BASE,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: depthMode ? 0.2 : 0.7
      })
    },
    { timeoutMs: 60000, retries: 2 }
  );

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || "DeepSeek 调用失败");
  }

  return json.choices?.[0]?.message?.content || "";
}

/* ================= Gemini ================= */

async function callGemini(model, messages, depthMode) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("缺少 GEMINI_API_KEY");

  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`;

  const contents = messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }]
    }));

  const res = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: depthMode ? 0.2 : 0.8
        }
      })
    },
    { timeoutMs: 60000, retries: 2 }
  );

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || "Gemini 调用失败");
  }

  return json.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

/* ================= 统一出口（防炸） ================= */

export async function callModel(provider, model, messages, depthMode) {
  try {
    if (provider === "openai") {
      return await callOpenAI(model, messages, depthMode);
    }
    if (provider === "deepseek") {
      return await callDeepSeek(model, messages, depthMode);
    }
    if (provider === "gemini") {
      return await callGemini(model, messages, depthMode);
    }
    throw new Error("未知 provider: " + provider);
  } catch (err) {
    console.error(`[ModelError] ${provider}/${model}`, err);
    return "⚠️ 当前模型暂时不可用，请稍后重试或切换模型。";
  }
}
