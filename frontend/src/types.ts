export interface ChatSession {
  id: number;
  title: string;
  model_id: string;
  created_at: string;
  updated_at: string;
}

export interface CanvasData {
  id?: string;
  title: string;
  content: string;
}

export interface ChatMessage {
  id: string | number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;

  // -------- 前端 UI 扩展字段（后端不强制返回）--------
  kind?: 'text' | 'canvas';
  canvas?: CanvasData;
}
