import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

export const pool = mysql.createPool({
  // 兼容多种命名：docker-compose 常见的 MYSQL_* / DB_* / DB_DATABASE
  host: process.env.MYSQL_HOST || process.env.DB_HOST || '127.0.0.1',
  user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
  password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '',
  database:
    process.env.MYSQL_DATABASE ||
    process.env.DB_NAME ||
    process.env.DB_DATABASE ||
    'ai_mobile_chat',
  port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});
