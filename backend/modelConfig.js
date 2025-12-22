// backend/modelConfig.js

/**
 * 每一个 modelId = 一个“能力配置”
 * server.js 永远不关心 provider / 细节
 */
export const MODEL_MAP = {
  /* ========== OpenAI GPT 系列 ========== */
  "gpt-5": {
    provider: "openai",
    model: "gpt-5",
    capabilities: {
      reasoning: true,
      webSearch: true,
      vision: true,
      canvas: true
    }
  },

  // 兼容前端 constants.ts 的历史 ID（如 OpenAI 不支持该模型名，会在调用时返回可读错误）
  "gpt-5.1": {
    provider: "openai",
    model: "gpt-5.1",
    capabilities: {
      reasoning: true,
      webSearch: true,
      vision: true,
      canvas: true
    }
  },

  "gpt-5.1-codex": {
    provider: "openai",
    model: "gpt-5.1-codex",
    capabilities: {
      reasoning: true,
      webSearch: true,
      vision: false,
      canvas: true
    }
  },

  "gpt-5-mini": {
    provider: "openai",
    model: "gpt-5-mini",
    capabilities: {
      reasoning: false,
      webSearch: true,
      vision: true,
      canvas: true
    }
  },

  /* ========== DeepSeek ========== */
  "deepseek-chat": {
    provider: "deepseek",
    model: "deepseek-chat",
    capabilities: {
      reasoning: false,
      webSearch: false,
      vision: false,
      canvas: false
    }
  },

  "deepseek-reasoner": {
    provider: "deepseek",
    model: "deepseek-reasoner",
    capabilities: {
      reasoning: true,
      webSearch: false,
      vision: false,
      canvas: false
    }
  },

  /* ========== Gemini ========== */
  "gemini-1.5-pro": {
    provider: "gemini",
    model: "gemini-1.5-pro",
    capabilities: {
      reasoning: false,
      webSearch: false,
      vision: true,
      canvas: false
    }
  },

  // 兼容前端 constants.ts 的历史 ID
  "gemini-3-pro-preview": {
    provider: "gemini",
    model: "gemini-3-pro-preview",
    capabilities: {
      reasoning: false,
      webSearch: false,
      vision: true,
      canvas: false
    }
  }
};
