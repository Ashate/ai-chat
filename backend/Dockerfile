FROM node:20-alpine

WORKDIR /app

# 安装依赖
COPY package*.json ./
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN npm config set registry $NPM_REGISTRY \
  && npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 60000 \
  && npm config set fetch-timeout 60000 \
  && npm install --production --no-audit --no-fund

# 拷贝源码
COPY . .

# uploads 目录
RUN mkdir -p uploads

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "server.js"]

