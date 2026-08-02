# AutoDL 部署指南：See-through Live2D 后端

## 架构概览

```
[浏览器/前端]  ←HTTP→  [AutoDL:8000 FastAPI]  ←subprocess→  [see-through-main 推理]
   本地 localhost        GPU 实例公网 IP                       PyTorch + CUDA
```

前端跑在本地（`npm run dev`），后端跑在 AutoDL GPU 实例。前端通过 `VITE_API_BASE` 环境变量指向 AutoDL 公网地址。

---

## 前置条件

| 项 | 要求 |
|---|---|
| AutoDL 实例 | RTX 4090 / 3090 / A100，已开机且未被抢占 |
| see-through-main | 已克隆到 `/root/see-through-main`，依赖已装 |
| conda 环境 | 名为 `see_through`，已装 torch+CUDA 和 see-through-main 依赖 |
| 模型缓存 | 已指向 `/root/autodl-tmp/hf_cache`，模型已下载 |
| 系统盘 | ≥5GB 剩余（用于 FastAPI 后端，模型/数据放数据盘） |

---

## 部署步骤

### 1. 上传 backend 目录到 AutoDL

在本地 PowerShell 执行（把 `YOUR_AUTODL_IP` 换成你的实例公网 IP，密码在 AutoDL 控制台）：

```powershell
# 用 scp 上传整个 backend 目录
scp -r D:\projects\ai-live2d-studio\backend root@YOUR_AUTODL_IP:/root/see-through-live2d-backend
```

或用 AutoDL 提供的 JupyterLab 网页上传（适合无 scp 经验）：
1. AutoDL 控制台 → 容器实例 → 自定义服务 → 打开 JupyterLab
2. 在 `/root/` 下新建目录 `see-through-live2d-backend`
3. 把本地 `backend/` 下的 `main.py`、`requirements.txt`、`deploy_autodl.sh` 三个文件拖进去

### 2. 执行部署脚本

在 AutoDL 终端（SSH 或 JupyterLab Terminal）执行：

```bash
bash /root/see-through-live2d-backend/deploy_autodl.sh
```

脚本会自动完成 6 个步骤：
1. 环境检查（see-through-main / conda / GPU）
2. 激活 `see_through` conda 环境
3. 安装 FastAPI 后端依赖（fastapi/uvicorn/python-multipart）
4. 配置工作目录到数据盘 `/root/autodl-tmp/live2d_workspace`
5. 启动 uvicorn 服务
6. 日志输出到终端 + `/root/autodl-tmp/live2d_workspace/server.log`

### 3. 验证后端启动

看到类似输出表示成功：

```
[部署] Step 5/6: 启动 FastAPI 服务
[信息]  启动命令: uvicorn main:app --host 0.0.0.0 --port 8000
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete.
```

在 AutoDL 终端另开一个窗口验证：

```bash
curl http://localhost:8000/api/health
```

应返回：
```json
{
  "status": "ok",
  "seethrough_path": "/root/see-through-main",
  "seethrough_available": true,
  "gpu_available": true
}
```

### 4. 开放端口对外访问

AutoDL 默认只开放 6006 端口。两种方案：

**方案 A：用 AutoDL 自定义服务（推荐，免费）**

AutoDL 控制台 → 容器实例 → 自定义服务 → 开启。它会自动把容器内 6006 端口映射到公网。

所以把 uvicorn 改到 6006 端口：

```bash
# 停掉刚才 8000 的服务（Ctrl+C），改用 6006
cd /root/see-through-live2d-backend
SEETHROUGH_PATH=/root/see-through-main \
WORKSPACE_DIR=/root/autodl-tmp/live2d_workspace \
CUDA_VISIBLE_DEVICES=0 \
CORS_ORIGINS="*" \
HF_HOME=/root/autodl-tmp/hf_cache \
python -m uvicorn main:app --host 0.0.0.0 --port 6006
```

控制台「自定义服务」会给你一个公网 URL，类似：
```
https://www.autodl.com/api/v1/iot/transport-headers/xxxxx/proxy/6006/
```

**方案 B：本地 SSH 端口转发（仅自己测试用）**

本地 PowerShell：
```powershell
ssh -L 8000:localhost:8000 root@YOUR_AUTODL_IP
```
保持这个 SSH 不断，本地访问 `http://localhost:8000` 就等于访问 AutoDL 的 8000。

### 5. 配置前端 API 地址

在本地前端目录创建 `.env.local`：

**方案 A（公网 URL）**：
```bash
# D:\projects\ai-live2d-studio\frontend\.env.local
VITE_API_BASE=https://www.autodl.com/api/v1/iot/transport-headers/xxxxx/proxy/6006
```

**方案 B（本地转发）**：
```bash
VITE_API_BASE=http://localhost:8000
```

### 6. 启动前端联调

```powershell
cd D:\projects\ai-live2d-studio\frontend
npm run dev
```

打开 http://localhost:5173/

操作流程：
1. 点顶部「AI 智能分解」按钮
2. 弹窗里点「检查」验证后端可达
3. 上传一张动漫角色图
4. 等待 1-3 分钟（LayerDiff → Marigold → SAM → LaMa → PSD 导出）
5. 完成后自动进入骨架模式，画布上会按原图位置摆好所有图层

---

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| POST | `/api/split` | 上传图片触发分解，返回 task_id |
| GET | `/api/task/{task_id}` | 查询任务状态（pending/running/completed/failed） |
| GET | `/api/result/{task_id}/psd` | 下载生成的 PSD |
| GET | `/api/result/{task_id}/preview/{path}` | 获取预览图 |
| DELETE | `/api/task/{task_id}` | 删除任务 |
| GET | `/api/tasks` | 列出所有任务 |

---

## 故障排查

### 后端起不来

| 现象 | 排查 |
|---|---|
| `conda env list` 没看到 `see_through` | 之前创建时可能用了别的名字，`conda env list` 看实际名字，改 `deploy_autodl.sh` 里的 `CONDA_ENV` |
| `ModuleNotFoundError: fastapi` | 脚本会自动装，若失败手动 `pip install fastapi uvicorn[standard] python-multipart` |
| `FileNotFoundError: see-through-main` | 检查 `SEETHROUGH_PATH` 是否正确，`ls /root/see-through-main/inference/scripts/inference_psd.py` |
| 端口 6006 被占 | `lsof -i:6006` 找占用进程，或换端口（同时改 AutoDL 自定义服务） |

### 推理失败

| 现象 | 排查 |
|---|---|
| GPU OOM | 上传参数加 `group_offload=true`（低显存模式）或降 `resolution=1024` |
| 模型下载失败 | `export HF_ENDPOINT=https://hf-mirror.com` 后重试 |
| 任务一直 running | 看日志 `/root/autodl-tmp/live2d_workspace/server.log` |
| PSD 未生成 | `ls /root/autodl-tmp/live2d_workspace/tasks/*/output/` 看实际产物 |

### 前端连不上

| 现象 | 排查 |
|---|---|
| CORS 错误 | 后端已开 `CORS_ORIGINS=*`，应该不会；若有问题检查浏览器控制台 |
| 502/504 | AutoDL 自定义服务超时，长任务建议轮询间隔调大 |
| 健康检查失败 | 先 `curl` AutoDL 公网 URL，确认服务确实在跑 |

---

## 关机与重启

**关机前**：在 uvicorn 终端按 `Ctrl+C` 停服务（保存日志）。

**重新开机后**：
```bash
bash /root/see-through-live2d-backend/deploy_autodl.sh
```
脚本幂等，重复执行没问题。模型缓存已存在不会重下。

---

## 成本提示

- RTX 4090 约 ¥2/小时，单次推理 1-3 分钟
- **建议用完立即关机**（AutoDL 控制台一键关机，开机后环境保留）
- 模型缓存在数据盘 `/root/autodl-tmp/hf_cache`，关机不丢失
