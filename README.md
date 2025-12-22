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
