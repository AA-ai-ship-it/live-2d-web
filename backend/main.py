"""
See-through Live2D 分解服务 - FastAPI 后端

部署说明（AutoDL 等 GPU 云机器）：
1. 克隆 see-through-main 仓库到服务器
2. 安装 see-through-main 依赖：pip install -r requirements.txt
3. 安装本服务依赖：pip install -r backend/requirements.txt
4. 设置环境变量：
   - SEETHROUGH_PATH=/path/to/see-through-main
   - CUDA_VISIBLE_DEVICES=0
5. 启动：cd backend && uvicorn main:app --host 0.0.0.0 --port 8000
"""

import os
import sys
import uuid
import json
import shutil
import asyncio
import subprocess
import threading
from pathlib import Path
from typing import Optional
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# ========================
# 配置
# ========================

# see-through-main 仓库根目录（通过环境变量配置）
SEETHROUGH_PATH = os.environ.get("SEETHROUGH_PATH", "/root/see-through-main")

# 工作目录：上传的图片和生成的结果存放位置
WORKSPACE_DIR = Path(os.environ.get("WORKSPACE_DIR", "./workspace"))
WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)

# 任务存储目录
TASKS_DIR = WORKSPACE_DIR / "tasks"
TASKS_DIR.mkdir(parents=True, exist_ok=True)

# 推理参数默认值
DEFAULT_RESOLUTION = int(os.environ.get("SEETHROUGH_RESOLUTION", "1280"))
DEFAULT_STEPS = int(os.environ.get("SEETHROUGH_STEPS", "30"))
USE_GROUP_OFFLOAD = os.environ.get("SEETHROUGH_GROUP_OFFLOAD", "0") == "1"

# ========================
# NSFW 检测配置（AWS Rekognition）
# ========================
# 海外版必需：Stripe 对允许 NSFW 内容的商户会罚款 $50,000 并封号
# 通过环境变量控制：
#   NSFW_CHECK_ENABLED=1  启用（默认）
#   NSFW_CHECK_ENABLED=0  禁用（仅本地开发/测试用）
#   NSFW_REJECT_THRESHOLD=0.8  超过此置信度直接拒绝（自动）
#   NSFW_REVIEW_THRESHOLD=0.5  超过此置信度进入人工复审（前端可手动覆盖）
#   AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  AWS 凭证
NSFW_CHECK_ENABLED = os.environ.get("NSFW_CHECK_ENABLED", "1") == "1"
NSFW_REJECT_THRESHOLD = float(os.environ.get("NSFW_REJECT_THRESHOLD", "0.8"))
NSFW_REVIEW_THRESHOLD = float(os.environ.get("NSFW_REVIEW_THRESHOLD", "0.5"))
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# boto3 客户端（延迟初始化，避免未配置凭证时启动失败）
_rekognition_client = None
_boto3_available = False
try:
    import boto3
    _boto3_available = True
except ImportError:
    print("[NSFW] 警告: boto3 未安装，NSFW 检测将降级为跳过。请运行 pip install boto3", flush=True)


def _get_rekognition_client():
    """延迟初始化 AWS Rekognition 客户端（首次调用时创建）"""
    global _rekognition_client
    if _rekognition_client is not None:
        return _rekognition_client

    if not _boto3_available:
        return None

    # 检查凭证是否配置
    aws_key = os.environ.get("AWS_ACCESS_KEY_ID")
    aws_secret = os.environ.get("AWS_SECRET_ACCESS_KEY")
    if not aws_key or not aws_secret:
        print("[NSFW] 警告: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY 未配置，NSFW 检测将跳过", flush=True)
        return None

    try:
        _rekognition_client = boto3.client(
            "rekognition",
            region_name=AWS_REGION,
            aws_access_key_id=aws_key,
            aws_secret_access_key=aws_secret,
        )
        print(f"[NSFW] AWS Rekognition 客户端已初始化 (region={AWS_REGION})", flush=True)
        return _rekognition_client
    except Exception as e:
        print(f"[NSFW] 初始化 AWS Rekognition 客户端失败: {e}", flush=True)
        return None


def check_nsfw_labels(image_bytes: bytes) -> dict:
    """
    调用 AWS Rekognition DetectModerationLabels 检测图片 NSFW 内容

    返回结构：
    {
        "enabled": bool,          # NSFW 检测是否启用
        "checked": bool,          # 是否实际执行了检测（False = 跳过/降级）
        "passed": bool,           # 是否通过（action == "pass"）
        "action": str,            # "pass" | "review" | "reject" | "skipped"
        "max_confidence": float,  # 最高置信度（0-1）
        "labels": [               # 检测到的标签列表
            {"name": str, "confidence": float, "parent_categories": [str]}
        ],
        "error": str,             # 错误信息（如有）
    }
    """
    result = {
        "enabled": NSFW_CHECK_ENABLED,
        "checked": False,
        "passed": True,
        "action": "skipped",
        "max_confidence": 0.0,
        "labels": [],
        "error": "",
    }

    # 未启用 → 直接放行
    if not NSFW_CHECK_ENABLED:
        result["action"] = "pass"
        return result

    client = _get_rekognition_client()
    if client is None:
        # 降级：未配置凭证或 boto3 未安装，记录警告但放行
        # 生产环境应在监控告警中关注此情况
        print("[NSFW] 降级放行：AWS Rekognition 不可用（boto3 未安装或凭证未配置）", flush=True)
        result["error"] = "NSFW detection unavailable (boto3/AWS credentials not configured)"
        result["action"] = "pass"
        return result

    try:
        response = client.detect_moderation_labels(
            Image={"Bytes": image_bytes},
            MinConfidence=NSFW_REVIEW_THRESHOLD * 100,  # AWS 使用 0-100
        )

        labels = []
        max_conf = 0.0
        for lbl in response.get("ModerationLabels", []):
            conf = lbl.get("Confidence", 0) / 100.0  # 转换为 0-1
            labels.append({
                "name": lbl.get("Name", "Unknown"),
                "confidence": round(conf, 4),
                "parent_categories": lbl.get("ParentCategories", []),
            })
            if conf > max_conf:
                max_conf = conf

        result["checked"] = True
        result["labels"] = labels
        result["max_confidence"] = round(max_conf, 4)

        # 根据阈值决定动作
        if max_conf >= NSFW_REJECT_THRESHOLD:
            result["action"] = "reject"
            result["passed"] = False
        elif max_conf >= NSFW_REVIEW_THRESHOLD:
            result["action"] = "review"
            result["passed"] = False  # 需要人工确认才能继续
        else:
            result["action"] = "pass"
            result["passed"] = True

        print(f"[NSFW] 检测完成: action={result['action']}, max_conf={max_conf:.4f}, "
              f"labels={[l['name'] for l in labels]}", flush=True)

    except Exception as e:
        # 检测失败时降级放行（避免后端完全不可用）
        # 但记录错误，便于排查
        print(f"[NSFW] 检测失败，降级放行: {e}", flush=True)
        result["error"] = f"NSFW detection failed: {str(e)}"
        result["action"] = "pass"

    return result

# 线程池：用于异步执行 GPU 推理任务（避免阻塞事件循环）
executor = ThreadPoolExecutor(max_workers=1)

# 推理锁：确保同一时间只有一个推理任务在跑（GPU 不支持并发）
inference_lock = threading.Lock()

app = FastAPI(title="See-through Live2D API", version="1.0.0")

# CORS：允许前端跨域调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ========================
# 数据模型
# ========================

class TaskStatus(BaseModel):
    task_id: str
    status: str  # pending | running | completed | failed
    progress: float  # 0-1
    message: str
    result: Optional[dict] = None  # 完成时返回结果信息


class SplitRequest(BaseModel):
    resolution: int = DEFAULT_RESOLUTION
    inference_steps: int = DEFAULT_STEPS
    tblr_split: bool = True  # 左右对称部位拆分（如眼睛）
    group_offload: bool = USE_GROUP_OFFLOAD


# ========================
# 任务状态管理（内存存储，生产环境建议用 Redis）
# ========================

tasks: dict[str, TaskStatus] = {}


def update_task(task_id: str, status: str, progress: float, message: str, result: dict | None = None):
    tasks[task_id] = TaskStatus(
        task_id=task_id,
        status=status,
        progress=progress,
        message=message,
        result=result,
    )
    # 持久化到文件（便于服务重启后恢复）
    task_file = TASKS_DIR / task_id / "status.json"
    task_file.parent.mkdir(parents=True, exist_ok=True)
    task_file.write_text(json.dumps(tasks[task_id].model_dump(), ensure_ascii=False, indent=2), encoding="utf-8")


def load_task(task_id: str) -> TaskStatus | None:
    if task_id in tasks:
        return tasks[task_id]
    # 尝试从文件恢复
    task_file = TASKS_DIR / task_id / "status.json"
    if task_file.exists():
        data = json.loads(task_file.read_text(encoding="utf-8"))
        tasks[task_id] = TaskStatus(**data)
        return tasks[task_id]
    return None


# ========================
# 核心：调用 see-through-main 推理脚本
# ========================

def run_inference(task_id: str, image_path: Path, output_dir: Path, params: SplitRequest):
    """在子进程中运行 see-through-main 的推理脚本（加锁 + 实时日志透传）"""
    # 等待获取锁（确保同一时间只有一个推理任务）
    update_task(task_id, "pending", 0, "等待 GPU 空闲（前面有任务在跑）...")

    with inference_lock:
        try:
            update_task(task_id, "running", 0.1, "正在初始化 AI 模型...")

            # 构建命令
            cmd = [
                sys.executable,
                "-u",  # 关键：Python 无缓冲输出，否则日志会延迟
                "inference/scripts/inference_psd.py",
                "--srcp", str(image_path),
                "--save_dir", str(output_dir),
                "--save_to_psd",
                "--resolution", str(params.resolution),
                "--inference_steps", str(params.inference_steps),
                "--seed", "42",
                "--disable_progressbar",  # 进度条会污染日志，改用阶段关键词
            ]
            if params.tblr_split:
                cmd.append("--tblr_split")
            if params.group_offload:
                cmd.append("--group_offload")

            print(f"[任务 {task_id}] 启动推理: {' '.join(cmd)}", flush=True)
            update_task(task_id, "running", 0.2, "AI 正在分解图片（LayerDiff + Marigold + SAM）...")

            # 设置环境变量：确保 CUDA 可见、HF 缓存正确
            env = os.environ.copy()
            env["CUDA_VISIBLE_DEVICES"] = "0"
            env["PYTHONUNBUFFERED"] = "1"  # Python 输出不缓冲
            env["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"  # 减少显存碎片

            # 在 see-through-main 仓库根目录下运行
            process = subprocess.Popen(
                cmd,
                cwd=SEETHROUGH_PATH,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env=env,
            )

            # 实时读取输出（透传到主日志 + 用于进度反馈）
            progress = 0.2
            for line in process.stdout:
                line = line.rstrip()
                if not line:
                    continue
                # 透传到主日志（关键：便于排查问题）
                print(f"[任务 {task_id}] {line}", flush=True)

                # 根据输出关键词更新进度
                low = line.lower()
                if "layerdiff" in low or "layer_diff" in low:
                    progress = max(progress, 0.3)
                    update_task(task_id, "running", progress, "LayerDiff 透明层生成中...")
                elif "marigold" in low or "depth" in low:
                    progress = max(progress, 0.5)
                    update_task(task_id, "running", progress, "Marigold 深度估计中...")
                elif "sam" in low or "segment" in low or "part" in low:
                    progress = max(progress, 0.7)
                    update_task(task_id, "running", progress, "SAM 语义分割中...")
                elif "inpaint" in low or "lama" in low:
                    progress = max(progress, 0.85)
                    update_task(task_id, "running", progress, "LaMa 遮挡修复中...")
                elif "psd" in low or "save" in low:
                    progress = max(progress, 0.95)
                    update_task(task_id, "running", progress, "正在导出 PSD 文件...")
                # 检测错误关键词
                elif "error" in low or "exception" in low or "traceback" in low or "failed" in low:
                    print(f"[任务 {task_id}] ⚠️ 检测到错误: {line}", flush=True)

            process.wait()

            if process.returncode != 0:
                update_task(task_id, "failed", progress, f"推理失败，退出码 {process.returncode}")
                return

            # 查找生成的 PSD 文件
            psd_files = list(output_dir.glob("**/*.psd"))
            if not psd_files:
                update_task(task_id, "failed", 1.0, "未找到生成的 PSD 文件")
                return

            psd_file = psd_files[0]

            # 收集预览图（各层 PNG）
            preview_images = []
            for png in output_dir.glob("**/*.png"):
                preview_images.append({
                    "name": png.stem,
                    "path": str(png.relative_to(output_dir)),
                })

            update_task(task_id, "completed", 1.0, "分解完成", result={
                "psd_file": str(psd_file.relative_to(output_dir)),
                "preview_images": preview_images,
                "output_dir": str(output_dir),
            })

        except Exception as e:
            update_task(task_id, "failed", 0, f"任务异常: {str(e)}")

        finally:
            # ====== 推理完成后删除原图（降低数据安全风险）======
            # 只保留分层结果（output 目录），原图不长期存储
            try:
                if image_path.exists():
                    image_path.unlink()
                    print(f"[任务 {task_id}] 原图已删除（数据安全策略）", flush=True)
            except Exception as cleanup_err:
                print(f"[任务 {task_id}] 删除原图失败: {cleanup_err}", flush=True)


# ========================
# API 路由
# ========================

@app.get("/api/health")
async def health():
    """健康检查"""
    seethrough_exists = Path(SEETHROUGH_PATH).exists()
    return {
        "status": "ok",
        "seethrough_path": SEETHROUGH_PATH,
        "seethrough_available": seethrough_exists,
        "gpu_available": _check_gpu(),
        # NSFW 检测状态（前端用于显示是否启用）
        "nsfw_check_enabled": NSFW_CHECK_ENABLED,
        "nsfw_check_available": _get_rekognition_client() is not None,
    }


def _check_gpu() -> bool:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5
        )
        return result.returncode == 0 and bool(result.stdout.strip())
    except Exception:
        return False


@app.post("/api/check_nsfw")
async def check_nsfw(file: UploadFile = File(...)):
    """
    NSFW 内容检测（上传前预检）

    使用 AWS Rekognition DetectModerationLabels API。
    返回检测结果和动作建议（pass / review / reject）。

    前端流程：
    1. 用户选图后调用本接口
    2. action == "pass" → 直接上传分割
    3. action == "review" → 显示警告，用户可选择「取消」或「坚持上传」
    4. action == "reject" → 拒绝上传，不可覆盖
    5. action == "skipped" → 检测不可用，直接放行（降级）
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Please upload an image file")

    # 读取图片字节（AWS Rekognition 需要原始字节）
    image_bytes = await file.read()

    if not image_bytes:
        raise HTTPException(status_code=400, detail="Image file is empty")

    # 限制图片大小（10MB，与 AWS Rekognition 限制一致）
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")

    result = check_nsfw_labels(image_bytes)
    return result


@app.post("/api/split")
async def split_image(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    resolution: int = DEFAULT_RESOLUTION,
    inference_steps: int = DEFAULT_STEPS,
    tblr_split: bool = True,
    group_offload: bool = USE_GROUP_OFFLOAD,
    skip_nsfw_check: bool = False,
):
    """
    上传图片并触发 AI 分解任务

    返回 task_id，前端通过 GET /api/task/{task_id} 轮询状态

    NSFW 预检：
    - skip_nsfw_check=False（默认）：执行 NSFW 检测
      - action == "reject" → 返回 400，拒绝处理
      - action == "review" → 返回 202，要求前端确认后用 skip_nsfw_check=True 重新提交
      - action == "pass" / "skipped" → 正常处理
    - skip_nsfw_check=True：跳过检测（仅用于人工复审后的覆盖提交）
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="请上传图片文件")

    if resolution > 1024:
        raise HTTPException(status_code=400, detail="分辨率超过限制，最大支持1024px（12GB显存限制）")

    if resolution < 512:
        raise HTTPException(status_code=400, detail="分辨率过低，最小支持512px")

    # 验证 see-through-main 是否可用
    if not Path(SEETHROUGH_PATH).exists():
        raise HTTPException(
            status_code=500,
            detail=f"see-through-main 未找到: {SEETHROUGH_PATH}。请设置 SEETHROUGH_PATH 环境变量"
        )

    # ====== NSFW 预检 ======
    # 读取图片字节（同时用于 NSFW 检测和保存）
    image_bytes = await file.read()

    if not image_bytes:
        raise HTTPException(status_code=400, detail="图片文件为空")

    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片过大（最大 10MB）")

    if not skip_nsfw_check:
        nsfw_result = check_nsfw_labels(image_bytes)

        if nsfw_result["action"] == "reject":
            # 高置信度 NSFW：直接拒绝，不可覆盖
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "NSFW_REJECTED",
                    "message": "Image rejected by NSFW detection",
                    "nsfw_result": nsfw_result,
                }
            )

        if nsfw_result["action"] == "review":
            # 中等置信度：返回 202，要求前端确认
            return JSONResponse(
                status_code=202,
                content={
                    "code": "NSFW_REVIEW_REQUIRED",
                    "message": "Image flagged for review. Confirm to proceed.",
                    "nsfw_result": nsfw_result,
                }
            )

        # pass / skipped → 正常处理
    else:
        # 跳过检测时记录日志（便于审计人工覆盖行为）
        print(f"[NSFW] 用户手动跳过检测（skip_nsfw_check=True）", flush=True)

    # 创建任务
    task_id = str(uuid.uuid4())[:8]
    task_dir = TASKS_DIR / task_id
    task_dir.mkdir(parents=True, exist_ok=True)

    # 保存上传的图片（用之前读到的字节，避免 file.file 已被消费）
    ext = Path(file.filename or "image.png").suffix or ".png"
    image_path = task_dir / f"input{ext}"
    image_path.write_bytes(image_bytes)

    # 输出目录
    output_dir = task_dir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    params = SplitRequest(
        resolution=resolution,
        inference_steps=inference_steps,
        tblr_split=tblr_split,
        group_offload=group_offload,
    )

    update_task(task_id, "pending", 0, "任务已创建，等待执行...")

    # 后台异步执行推理（FastAPI BackgroundTasks 会在线程池中运行同步函数）
    background_tasks.add_task(run_inference, task_id, image_path, output_dir, params)

    return {"task_id": task_id, "status": "pending"}


@app.get("/api/task/{task_id}")
async def get_task_status(task_id: str):
    """查询任务状态"""
    task = load_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


@app.get("/api/result/{task_id}/psd")
async def download_psd(task_id: str):
    """下载 PSD 文件"""
    task = load_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status != "completed" or not task.result:
        raise HTTPException(status_code=400, detail=f"任务未完成，当前状态: {task.status}")

    output_dir = Path(task.result["output_dir"])
    psd_path = output_dir / task.result["psd_file"]

    if not psd_path.exists():
        raise HTTPException(status_code=404, detail="PSD 文件不存在")

    return FileResponse(
        path=str(psd_path),
        media_type="image/vnd.adobe.photoshop",
        filename=f"{task_id}.psd",
    )


@app.get("/api/result/{task_id}/preview/{image_path:path}")
async def get_preview_image(task_id: str, image_path: str):
    """获取预览图片"""
    task = load_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status != "completed" or not task.result:
        raise HTTPException(status_code=400, detail="任务未完成")

    output_dir = Path(task.result["output_dir"])
    full_path = output_dir / image_path

    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="图片不存在")

    # 安全检查：防止路径穿越
    try:
        full_path.resolve().relative_to(output_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="非法路径")

    return FileResponse(path=str(full_path))


@app.delete("/api/task/{task_id}")
async def delete_task(task_id: str):
    """删除任务及其文件"""
    task = load_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    task_dir = TASKS_DIR / task_id
    if task_dir.exists():
        shutil.rmtree(task_dir)

    if task_id in tasks:
        del tasks[task_id]

    return {"status": "deleted"}


@app.get("/api/tasks")
async def list_tasks():
    """列出所有任务"""
    task_list = []
    for task_dir in TASKS_DIR.iterdir():
        if not task_dir.is_dir():
            continue
        status_file = task_dir / "status.json"
        if status_file.exists():
            task = load_task(task_dir.name)
            if task:
                task_list.append(task)
    return {"tasks": task_list}


# 静态文件服务（可选：用于提供预览图）
app.mount("/static", StaticFiles(directory=str(WORKSPACE_DIR)), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=6006,
        reload=False,
    )
