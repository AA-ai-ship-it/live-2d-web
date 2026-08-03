#!/bin/bash
# ============================================================
# RunPod 一键部署脚本：See-through Live2D 后端服务
#
# 适配 RunPod GPU Pod（与 AutoDL 版的差异）：
#   - 数据盘：/workspace（持久化，Pod 重启不丢；AutoDL 是 /root/autodl-tmp）
#   - Python：用 venv（RunPod PyTorch 模板已带 PyTorch+CUDA；AutoDL 用 conda）
#   - HuggingFace：海外直连，不用镜像（AutoDL 用 hf-mirror.com）
#   - 代码：从 GitHub clone（AutoDL 需手动上传）
#   - 自启：RunPod 用模板的 onstart 字段（AutoDL 用 ~/.autodl/start.sh）
#
# 使用方法：
#   1. RunPod 创建 Pod（RTX 3090 / 24GB，模板 RunPod PyTorch 2.1 + CUDA 12.1）
#   2. 暴露 HTTP 端口 6006
#   3. Connect → Start Web Terminal
#   4. 执行：
#        bash <(curl -sL https://raw.githubusercontent.com/AA-ai-ship-it/live-2d-web/main/backend/deploy_runpod.sh)
#      或先 clone 再执行：
#        git clone https://github.com/AA-ai-ship-it/live-2d-web.git /workspace/live2d-repo
#        bash /workspace/live2d-repo/backend/deploy_runpod.sh
#
# 环境变量（均有默认值，无需手动设置即可部署）：
#   SEE_THROUGH_REPO   默认 https://github.com/shitagaki-lab/see-through.git（SIGGRAPH 2026 原版）
#   BACKEND_REPO       默认 https://github.com/AA-ai-ship-it/live-2d-web.git
#   NSFW_CHECK_ENABLED 默认 1（启用 NSFW 检测，Stripe 合规必需）
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION  AWS Rekognition 凭证（可选，未配置则降级为跳过）
# ============================================================

set -e

# ======================== 配置 ========================
WORKSPACE="/workspace"
DATA_DIR="$WORKSPACE/live2d"                # 持久化数据根目录
SEETHROUGH_DIR="$DATA_DIR/see-through-main" # see-through-main 仓库
BACKEND_DIR="$DATA_DIR/backend"             # 后端代码
VENV_DIR="$DATA_DIR/venv"                   # Python 虚拟环境（持久化）
HF_CACHE="$DATA_DIR/hf_cache"               # HuggingFace 模型缓存
TASKS_DIR="$DATA_DIR/tasks"                 # 任务工作目录
PORT=6006
HOST="0.0.0.0"
LOG_FILE="$DATA_DIR/backend.log"
PID_FILE="$DATA_DIR/backend.pid"

# 仓库地址（可被环境变量覆盖）
BACKEND_REPO="${BACKEND_REPO:-https://github.com/AA-ai-ship-it/live-2d-web.git}"
SEE_THROUGH_REPO="${SEE_THROUGH_REPO:-https://github.com/shitagaki-lab/see-through.git}"

# 颜色
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()   { echo -e "${GREEN}[部署]${NC} $1"; }
warn()  { echo -e "${YELLOW}[警告]${NC} $1"; }
error() { echo -e "${RED}[错误]${NC} $1"; exit 1; }
info()  { echo -e "${CYAN}[信息]${NC} $1"; }

# ======================== 0. 前置检查 ========================
log "Step 0/7: 前置检查"

if [ ! -d "$WORKSPACE" ]; then
  error "数据盘 $WORKSPACE 不存在。请确认 RunPod 模板已挂载 Volume Disk 到 /workspace"
fi
info "  数据盘 $WORKSPACE ✓"

if [ -z "$SEE_THROUGH_REPO" ]; then
  error "SEE_THROUGH_REPO 为空，不应发生（脚本有默认值）。请检查脚本完整性。"
fi
info "  see-through 仓库: $SEE_THROUGH_REPO ✓"

if ! command -v nvidia-smi &> /dev/null; then
  error "nvidia-smi 不可用，GPU 未就位。请确认 Pod 已分配 GPU"
fi
GPU_INFO=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo "未知")
info "  GPU: $GPU_INFO ✓"

if ! command -v python3 &> /dev/null; then
  error "python3 不可用。请使用 RunPod PyTorch 官方模板"
fi
info "  Python: $(python3 --version 2>&1) ✓"

mkdir -p "$DATA_DIR" "$TASKS_DIR" "$HF_CACHE"
log "Step 0/7 通过"

# ======================== 1. 克隆 see-through-main ========================
log "Step 1/7: 克隆 see-through-main"

if [ -d "$SEETHROUGH_DIR/.git" ]; then
  info "  已存在，拉取最新代码..."
  cd "$SEETHROUGH_DIR" && git pull --ff-only 2>&1 | head -5 || warn "  git pull 失败，使用现有版本"
else
  info "  克隆中（首次可能较大）..."
  git clone --depth 1 "$SEE_THROUGH_REPO" "$SEETHROUGH_DIR"
fi

# 校验关键文件
if [ ! -f "$SEETHROUGH_DIR/inference/scripts/inference_psd.py" ]; then
  error "推理脚本不存在: $SEETHROUGH_DIR/inference/scripts/inference_psd.py
   请确认 SEE_THROUGH_REPO 地址正确：$SEE_THROUGH_REPO"
fi
info "  推理脚本存在 ✓"
log "Step 1/7 通过"

# ======================== 2. 克隆后端代码 ========================
log "Step 2/7: 克隆后端代码"

if [ -d "$BACKEND_DIR/.git" ]; then
  info "  已存在，拉取最新代码..."
  cd "$BACKEND_DIR" && git pull --ff-only 2>&1 | head -5 || warn "  git pull 失败，使用现有版本"
else
  info "  克隆后端仓库..."
  git clone --depth 1 "$BACKEND_REPO" "$DATA_DIR/live2d-repo"
  # 后端代码在仓库的 backend/ 子目录，复制出来
  cp -r "$DATA_DIR/live2d-repo/backend" "$BACKEND_DIR"
fi

if [ ! -f "$BACKEND_DIR/main.py" ]; then
  error "backend/main.py 未找到: $BACKEND_DIR/main.py"
fi
info "  backend/main.py 存在 ✓"
log "Step 2/7 通过"

# ======================== 3. 创建/激活 venv ========================
log "Step 3/7: 配置 Python 虚拟环境"

if [ ! -d "$VENV_DIR" ]; then
  info "  首次创建 venv（耗时 30s 左右）..."
  python3 -m venv "$VENV_DIR"
fi

# 激活 venv
source "$VENV_DIR/bin/activate"
info "  venv: $(python --version 2>&1) ✓"

# 升级 pip
pip install --upgrade pip --quiet 2>&1 | tail -1
log "Step 3/7 通过"

# ======================== 4. 安装依赖 ========================
log "Step 4/7: 安装依赖（首次耗时 5-15 分钟）"

# 4.1 see-through-main 依赖（如果它有 requirements.txt）
ST_REQ="$SEETHROUGH_DIR/requirements.txt"
if [ -f "$ST_REQ" ]; then
  info "  安装 see-through-main 依赖..."
  pip install -r "$ST_REQ" --quiet 2>&1 | tail -3 || warn "  部分依赖安装失败，可能已预装"
else
  warn "  see-through-main 无 requirements.txt，跳过（依赖可能已在模板中）"
fi

# 4.2 后端依赖（FastAPI + boto3）
info "  安装后端依赖（FastAPI + boto3）..."
pip install -r "$BACKEND_DIR/requirements.txt" --quiet 2>&1 | tail -3
info "  依赖安装完成 ✓"
log "Step 4/7 通过"

# ======================== 5. 环境变量 ========================
log "Step 5/7: 配置环境变量"

export SEETHROUGH_PATH="$SEETHROUGH_DIR"
export WORKSPACE_DIR="$TASKS_DIR"
export CUDA_VISIBLE_DEVICES=0
export PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"
export HF_HOME="$HF_CACHE"
export CORS_ORIGINS="*"

# 海外版不用 HF 镜像，直连官方
unset HF_ENDPOINT 2>/dev/null || true

# 推理参数（24GB 显存可跑 768px，768 以下用低显存模式）
export SEETHROUGH_RESOLUTION="${SEETHROUGH_RESOLUTION:-768}"
export SEETHROUGH_STEPS="${SEETHROUGH_STEPS:-20}"
export SEETHROUGH_GROUP_OFFLOAD="${SEETHROUGH_GROUP_OFFLOAD:-0}"

# NSFW 检测（Stripe 合规必需，默认开启；未配 AWS 凭证时自动降级为跳过+警告日志）
export NSFW_CHECK_ENABLED="${NSFW_CHECK_ENABLED:-1}"
export NSFW_REJECT_THRESHOLD="${NSFW_REJECT_THRESHOLD:-0.8}"
export NSFW_REVIEW_THRESHOLD="${NSFW_REVIEW_THRESHOLD:-0.5}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

# PYTHONPATH 必须包含 see-through-main 根目录 + common 子目录
export PYTHONPATH="$SEETHROUGH_DIR/common:$SEETHROUGH_DIR:${PYTHONPATH:-}"

info "  SEETHROUGH_PATH=$SEETHROUGH_PATH"
info "  WORKSPACE_DIR=$WORKSPACE_DIR"
info "  NSFW_CHECK_ENABLED=$NSFW_CHECK_ENABLED"
if [ -n "$AWS_ACCESS_KEY_ID" ]; then
  export AWS_ACCESS_KEY_ID
  export AWS_SECRET_ACCESS_KEY
  info "  AWS 凭证已配置 ✓"
else
  warn "  AWS_ACCESS_KEY_ID 未配置，NSFW 检测将降级为跳过（仅记录警告日志）"
  warn "  正式上线前必须配置 AWS 凭证（Stripe 合规要求）"
fi
log "Step 5/7 通过"

# ======================== 6. 杀掉旧进程 ========================
log "Step 6/7: 清理旧进程"

if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    info "  停止旧进程 $OLD_PID..."
    kill -9 "$OLD_PID" 2>/dev/null || true
    sleep 2
  fi
  rm -f "$PID_FILE"
fi
pkill -f "uvicorn main:app" 2>/dev/null || true
pkill -f "python -u main.py" 2>/dev/null || true
sleep 1
log "Step 6/7 通过"

# ======================== 7. 启动服务 ========================
log "Step 7/7: 启动后端服务"

cd "$BACKEND_DIR"

info "  启动命令: python -u main.py"
info "  端口: $PORT（RunPod 暴露的 HTTP 端口需与此一致）"
info "  日志: $LOG_FILE"
info "  按 Ctrl+C 停止"

# 后台启动（setsid 脱离终端，防止 SSH 断开杀进程）
setsid nohup python -u main.py > "$LOG_FILE" 2>&1 &
BACKEND_PID=$!
disown 2>/dev/null || true
echo "$BACKEND_PID" > "$PID_FILE"

info "  进程已启动 PID=$BACKEND_PID"

# 健康检查（最多 120s，模型首次加载慢）
info "  等待服务就绪（最多 120s，首次需下载 4-6GB 模型）..."
HEALTH_URL="http://127.0.0.1:$PORT/api/health"

for i in $(seq 1 120); do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    error "后端进程已退出！
   ----- backend.log 最后 40 行 -----
   $(tail -n 40 "$LOG_FILE" 2>/dev/null)
   -----------------------------------"
  fi

  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    log "✅ 后端服务已就绪！（耗时 ${i}s）"
    log "   本地: $HEALTH_URL"
    log "   公网: 见 RunPod Pod 卡片的 HTTP 端口 6006 链接"
    log "   下一步: 把该公网地址填入 Vercel 项目的 NEXT_PUBLIC_API_BASE 环境变量"
    log "========================================="
    exit 0
  fi

  if [ $((i % 15)) -eq 0 ]; then
    info "   ... 已等待 ${i}s，仍在启动（首次需下载模型）"
    info "   最新日志: $(tail -n 1 "$LOG_FILE" 2>/dev/null)"
  fi

  sleep 1
done

warn "服务启动超时（120s），可能仍在下载模型"
warn "手动检查: curl $HEALTH_URL  或  tail -n 50 $LOG_FILE"
exit 0
