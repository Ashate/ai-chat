import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // 生产环境安全要求：不允许缺省 secret
  throw new Error('缺少 JWT_SECRET（请在 .env 或 docker-compose.yml 中设置）');
}

export function authRequired(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: "登录已失效", code: "TOKEN_EXPIRED" });
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.id, email: payload.email };
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已失效' });
  }
}
