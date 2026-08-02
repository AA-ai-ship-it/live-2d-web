#!/bin/bash
# ============================================================
# AutoDL 开机自启脚本 - see-through Live2D 后端
# 放置位置: ~/.autodl/start.sh
# AutoDL 会在容器启动时以 root 身份自动执行此脚本
#
# 解决历史问题:
#   1. conda activate 失败 → 先 source profile.d/conda.sh
#   2. 路径错误静默失败 → 启动前做路径检查
#   3. nohup 进程被 SIGHUP 杀掉 → 用 setsid + disown
#   4. 无日志无法排查 → 全程写 /root/autodl-tmp/startup.log
# ============================================================

# ====== 日志函数 ======
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a /root/autodl-tmp/startup.log
}

log "========================================="
log "开始执行开机自启脚本"

# ====== 等待磁盘/网络就绪（容器刚启动时可能还没挂载好）======
sleep 3

# ====== 路径配置 ======
BACKEND_DIR="/root/autodl-tmp/see-through-live2d-backend"
SEETHROUGH_DIR="/root/autodl-tmp/see-through/see-through-main"
CONDA_SH="/root/miniconda3/etc/profile.d/conda.sh"
LOG_FILE="/root/autodl-tmp/backend.log"
PID_FILE="/root/autodl-tmp/backend.pid"
STARTUP_LOG="/root/autodl-tmp/startup.log"

# ====== 路径检查 ======
if [ ! -f "$BACKEND_DIR/main.py" ]; then
    log "❌ 后端代码不存在: $BACKEND_DIR/main.py"
    log "   请确认后端代码已部署到该路径"
    exit 1
fi
if [ ! -d "$SEETHROUGH_DIR" ]; then
    log "❌ see-through-main 不存在: $SEETHROUGH_DIR"
    exit 1
fi
log "✅ 路径检查通过"

# ====== conda 初始化 + 激活（关键：必须先 source 再 activate）======
if [ -f "$CONDA_SH" ]; then
    source "$CONDA_SH"
    log "✅ 已加载 conda 初始化脚本"
else
    log "❌ conda 初始化脚本不存在: $CONDA_SH"
    exit 1
fi

conda activate see_through
if [ $? -ne 0 ]; then
    log "❌ 激活 see_through 环境失败"
    exit 1
fi
log "✅ 已激活 see_through 环境, python=$(which python)"

# ====== 环境变量 ======
export PYTHONPATH="${SEETHROUGH_DIR}/common:${SEETHROUGH_DIR}:${PYTHONPATH}"
export HF_ENDPOINT="https://hf-mirror.com"
export PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"
export TRANSFORMERS_OFFLINE=0

log "✅ PYTHONPATH=$PYTHONPATH"

# ====== 杀掉旧进程 ======
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        log "⚠️  发现旧进程 $OLD_PID, 正在停止..."
        kill -9 "$OLD_PID" 2>/dev/null
        sleep 2
    fi
    rm -f "$PID_FILE"
fi

# pkill 兜底（按命令行匹配）
pkill -f "uvicorn main:app" 2>/dev/null || true
pkill -f "python -u main.py" 2>/dev/null || true
sleep 1

# ====== 启动后端 ======
cd "$BACKEND_DIR"
log "🚀 启动后端服务..."

# setsid: 脱离控制终端,防止 SIGHUP 杀进程
# nohup: 忽略 SIGHUP
# disown: 从 shell 作业表移除
setsid nohup python -u main.py > "$LOG_FILE" 2>&1 &
BACKEND_PID=$!
disown $BACKEND_PID 2>/dev/null || true
echo "$BACKEND_PID" > "$PID_FILE"

log "✅ 后端进程已启动, PID=$BACKEND_PID"
log "📝 运行日志: $LOG_FILE"

# ====== 等待启动 + 健康检查（最多 90 秒）======
log "⏳ 等待服务就绪（最多 90 秒）..."
HEALTH_URL="http://127.0.0.1:6006/api/health"

for i in $(seq 1 90); do
    # 进程是否还活着
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        log "❌ 后端进程已退出! 退出码: $(wait $BACKEND_PID 2>/dev/null; echo $?)"
        log "----- backend.log 最后 40 行 -----"
        tail -n 40 "$LOG_FILE" 2>/dev/null | tee -a "$STARTUP_LOG"
        log "-----------------------------------"
        exit 1
    fi

    # 健康检查
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
        log "✅ 后端服务已就绪! (耗时 ${i}s)"
        log "   本地地址: $HEALTH_URL"
        log "   公网地址: 见 AutoDL 实例面板的「自定义服务」端口 6006"
        log "========================================="
        exit 0
    fi

    # 每 10 秒打一次进度
    if [ $((i % 10)) -eq 0 ]; then
        log "   ... 已等待 ${i}s, 服务仍在启动中"
    fi

    sleep 1
done

log "⚠️  服务启动超时（90s），可能仍在加载模型"
log "   请手动检查:"
log "     curl $HEALTH_URL"
log "     tail -n 50 $LOG_FILE"
log "========================================="
exit 0
