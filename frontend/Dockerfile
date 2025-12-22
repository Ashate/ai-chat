# 构建阶段
FROM node:20-alpine AS build

WORKDIR /app

# 可选：解决部分环境 npm install 偶发 ECONNRESET
ARG NPM_REGISTRY=https://registry.npmjs.org/
COPY package*.json ./
RUN npm config set registry $NPM_REGISTRY \
  && npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 60000 \
  && npm config set fetch-timeout 60000 \
  && npm install --no-audit --no-fund
COPY . .
RUN npm run build

# 运行阶段（nginx）
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

