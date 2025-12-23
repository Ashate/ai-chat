# 说明
这是一个可以调用gpt、deepseek、Gemini模型API的Web项目。其功能包括文件、压缩包上传分析、对话内容自动生成标题、画布模式(gpt模型)、画布内容导出为word、md、pdf。

# 安装
## 1、安装mysql
```
sudo apt update
sudo apt install -y mysql-server
sudo systemctl enable --now mysql
```
## 2、允许docker网段连接mysql
修改 MySQL bind-address
编辑（不同系统可能位置略不同）：
/etc/mysql/mysql.conf.d/mysqld.cnf

找到/加入：
```
[mysqld]
bind-address = 0.0.0.0
```

重启mysql:
```
sudo systemctl restart mysql
```

## 创建数据库 + 创建用户 + 授权

```
sudo mysql
```

执行

``` sql

CREATE DATABASE IF NOT EXISTS ai_mobile_chat
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 创建一个专用账号，允许从任意来源连接（最省事）
CREATE USER IF NOT EXISTS 'ai_chat'@'%' IDENTIFIED BY '你的强密码';

GRANT ALL PRIVILEGES ON ai_mobile_chat.* TO 'ai_chat'@'%';
FLUSH PRIVILEGES;
```

###（可选）更严格：只允许 Docker 默认桥接网段 Docker 默认桥接网段常见是 172.17.0.0/16。你可以这样授权：
``` sql
CREATE USER IF NOT EXISTS 'ai_chat'@'172.17.%' IDENTIFIED BY '你的强密码';
GRANT ALL PRIVILEGES ON ai_mobile_chat.* TO 'ai_chat'@'172.17.%';
FLUSH PRIVILEGES;
```

如果你用的是自定义 docker network，网段可能不是 172.17，需要用 docker network inspect 看实际网段再授权。

## 3、初始化数据库表结构,mysql中执行:
``` sql
USE ai_mobile_chat;

-- users：后端登录/注册用到 email/password_hash
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- chat_sessions：会话列表用 title/model_id/updated_at
CREATE TABLE IF NOT EXISTS chat_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) DEFAULT '新对话',
  model_id VARCHAR(64) DEFAULT 'openai-mini',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_chat_user_time (user_id, updated_at),
  CONSTRAINT fk_chat_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- messages：后端会写入 user/assistant/system 三种 role
CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chat_id INT NOT NULL,
  role ENUM('user','assistant','system') NOT NULL,
  content LONGTEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_msg_chat_time (chat_id, created_at),
  CONSTRAINT fk_msg_chat FOREIGN KEY (chat_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- uploaded_files：/api/upload 写入，后端把 analysis_text 注入 system 消息
CREATE TABLE IF NOT EXISTS uploaded_files (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  chat_id BIGINT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) DEFAULT '',
  size BIGINT DEFAULT 0,
  analysis_text LONGTEXT,
  created_at DATETIME NOT NULL,
  INDEX idx_uploaded_files_user (user_id),
  INDEX idx_uploaded_files_chat (chat_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```