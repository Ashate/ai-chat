//------ id：技术标识符，用于内部传递、匹配 `modelConfig.js` 中的键名;label：用户可见的显示名称，用于前端 UI 下拉框、按钮等---------

export const MODELS = [
  { id: 'gpt-5-mini', label: 'gpt-5-mini' },
  { id: 'gpt-5.1-codex', label: 'gpt-5.1-codex' },
  { id: 'gpt-5.1', label: 'gpt-5.1' },
  { id: 'deepseek-chat', label: 'DeepSeek Chat' },
  { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
  { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro preview' }
];

export const DEFAULT_MODEL_ID = 'gpt-5-mini';
