// API_BASE 只负责“前缀”，不再兜底 localhost:4000
// 生产环境：/api  → 走 Nginx 同源
// 开发环境：可以在 .env.development 里再单独配置
const API_BASE = import.meta.env.VITE_API_BASE || '/api';

export async function apiRequest(
  path: string,
  options: RequestInit = {},
  token?: string | null
) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      'Content-Type': 'application/json'
    }
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || '请求失败');
  }

  return data;
}

/**
 * 文件上传
 * 注意：这里 path 也不再带 /api
 */
export async function apiUploadTempFile(
  file: File,
  token: string
) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(API_BASE + '/upload', {
    method: 'POST',
    headers: token ? { Authorization: 'Bearer ' + token } : undefined,
    body: formData
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || '上传失败');
  }

  return data;
}

/**
 * 兼容旧调用：忽略 chatId（现在是“先上传缓存，发送时再一起处理”）
 */
export async function apiUploadFile(
  file: File,
  token: string,
  _chatId: number
) {
  return apiUploadTempFile(file, token);
}

/**
 * 删除未发送/已发送的附件缓存
 */
export async function apiDeleteTempFile(fileId: number, token: string) {
  return apiRequest(`/files/${fileId}`, { method: 'DELETE' }, token);
}


/**
 * 删除会话
 */
export async function deleteChat(id: number, token: string) {
  return apiRequest(`/chats/${id}`, { method: 'DELETE' }, token);
}

