#!/bin/bash
# ============================================================
# AutoDL 一键部署脚本：See-through Live2D 后端服务
#
# 使用方法：
#   1. 将整个 backend/ 目录上传到 AutoDL 的 /root/see-through-live2d-backend/
#   2. 在 AutoDL 终端执行：bash /root/see-through-live2d-backend/deploy_autodl.sh
#
# 前置条件：
#   - see-through-main 仓库已克隆到 /root/see-through-main
#   - conda 环境 see_through 已创建并安装好 see-through-main 的依赖
#   - GPU 实例已开机且未被抢占
# ============================================================

set -e

# ======================== 配置 ========================
SEETHROUGH_PATH="/root/see-through-main"
CONDA_ENV="see_through"
BACKEND_DIR="/root/see-through-live2d-backend"
WORKSPACE_DIR="/root/autodl-tmp/live2d_workspace"
PORT=8000
HOST="0.0.0.0"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${GREEN}[部署]${NC} $1"; }
warn()  { echo -e "${YELLOW}[警告]${NC} $1"; }
error() { echo -e "${RED}[错误]${NC} $1"; exit 1; }
info()  { echo -e "${CYAN}[信息]${NC} $1"; }

# ======================== 1. 环境检查 ========================
log "Step 1/6: 环境检查"

# 检查 see-through-main
if [ ! -d "$SEETHROUGH_PATH" ]; then
  error "see-through-main 仓库未找到: $SEETHROUGH_PATH"
fi
info "  see-through-main: $SEETHROUGH_PATH ✓"

# 检查推理脚本
if [ ! -f "$SEETHROUGH_PATH/inference/scripts/inference_psd.py" ]; then
  error "推理脚本未找到: $SEETHROUGH_PATH/inference/scripts/inference_psd.py"
fi
info "  推理脚本存在 ✓"

# 检查 conda
if ! command -v conda &> /dev/null; then
  error "conda 未安装"
fi
info "  conda 可用 ✓"

# 检查 GPU
if ! command -v nvidia-smi &> /dev/null; then
  warn "nvidia-smi 不可用，GPU 可能未就位"
else
  GPU_INFO=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo "未知")
  info "  GPU: $GPU_INFO ✓"
fi

# 检查 backend 目录
if [ ! -f "$BACKEND_DIR/main.py" ]; then
  error "backend/main.py 未找到: $BACKEND_DIR/main.py"
fi
info "  backend/main.py 存在 ✓"

# ======================== 2. 激活 conda 环境 ========================
log "Step 2/6: 激活 conda 环境 $CONDA_ENV"

# 初始化 conda（AutoDL 通常已初始化，但保险起见）
eval "$(conda shell.bash hook)"

if ! conda env list | grep -q "^$CONDA_ENV\s"; then
  error "conda 环境不存在: $CONDA_ENV（请先创建环境并安装 see-through-main 依赖）"
fi

conda activate "$CONDA_ENV"
info "  当前环境: $CONDA_ENV ✓"
info "  Python: $(python --version 2>&1) ✓"

# ======================== 3. 安装后端依赖 ========================
log "Step 3/6: 安装后端依赖（FastAPI 等）"

# 检查 fastapi 是否已装
if python -c "import fastapi" 2> /dev/null; then
  info "  fastapi 已安装 ✓"
else
  info "  安装 fastapi/uvicorn/python-multipart..."
  pip install -q fastapi "uvicorn[standard]" python-multipart pydantic
  info "  依赖安装完成 ✓"
fi

# ======================== 4. 工作目录与缓存 ========================
log "Step 4/6: 配置工作目录"

# 任务目录（放数据盘，避免系统盘 30GB 不够）
mkdir -p "$WORKSPACE_DIR/tasks"
info "  工作目录: $WORKSPACE_DIR ✓"

# HuggingFace 模型缓存指向数据盘
export HF_HOME="/root/autodl-tmp/hf_cache"
mkdir -p "$HF_HOME"
info "  HF 缓存: $HF_HOME ✓"

# 国内镜像（AutoDL 已配但保险）
export HF_ENDPOINT="https://hf-mirror.com"

# ======================== 5. 启动服务 ========================
log "Step 5/6: 启动 FastAPI 服务"

# 环境变量传给后端
export SEETHROUGH_PATH="$SEETHROUGH_PATH"
export WORKSPACE_DIR="$WORKSPACE_DIR"
export CUDA_VISIBLE_DEVICES=0
export CORS_ORIGINS="*"

cd "$BACKEND_DIR"

info "  启动命令: uvicorn main:app --host $HOST --port $PORT"
info "  健康检查: http://localhost:$PORT/api/health"
info "  日志输出到: $WORKSPACE_DIR/server.log"
info ""
info "  按 Ctrl+C 停止服务"
info "  ================================"

# 前台启动（便于看日志），日志同时写入文件
exec python -m uvicorn main:app \
  --host "$HOST" \
  --port "$PORT" \
  --workers 1 \
  2>&1 | tee "$WORKSPACE_DIR/server.log"
