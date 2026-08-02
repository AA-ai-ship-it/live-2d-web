"""
Rembg 前景分割（替代百度 AI，海外版使用）

Rembg = U2Net 模型封装，本地运行，零费用，海外可用
- 优势：不依赖国内服务、无 API 调用费用、无审查、支持动漫/二次元角色
- 模型首次运行会自动下载（约 170MB），之后缓存本地
- 输出：RGBA 图，alpha 通道即前景 mask

安装：
    pip install rembg
    pip install onnxruntime   # CPU 推理（默认）
    # 或 onnxruntime-gpu  # GPU 推理（可选，更快）

使用：
    from rembg_segmentation import get_foreground_mask
    mask = get_foreground_mask(image_path, output_dir)
    # mask: np.ndarray (H, W) bool，True = 前景
"""

import os
import time
import numpy as np
from PIL import Image
from pathlib import Path


# Rembg 会话（延迟初始化，避免首次 import 时下载模型）
_rembg_session = None


def _get_rembg_session():
    """延迟初始化 Rembg 会话（首次调用时下载/加载模型）"""
    global _rembg_session
    if _rembg_session is not None:
        return _rembg_session

    try:
        from rembg import new_session
    except ImportError:
        raise ImportError(
            "rembg 未安装。请运行：\n"
            "  pip install rembg onnxruntime\n"
            "首次运行会自动下载 u2net 模型（约 170MB）"
        )

    print("[rembg] 初始化会话（首次会下载模型约 170MB）...")
    t0 = time.time()
    # 使用 u2net 模型（通用，人像分割质量好）
    _rembg_session = new_session("u2net")
    print(f"[rembg] 会话就绪，耗时 {time.time()-t0:.1f}s")
    return _rembg_session


def get_foreground_mask(image_path: str, output_dir: str) -> np.ndarray:
    """
    调用 Rembg 前景分割，返回完整前景的二值 mask

    接口与 baidu_segmentation.call_body_seg 兼容（用于 inpaint_pipeline.py）

    Args:
        image_path: 输入图片路径
        output_dir: 输出目录（保存前景图和 mask，便于调试）

    Returns:
        np.ndarray (H, W) bool，True = 前景像素
    """
    print(f"\n[步骤3] Rembg 前景分割...")

    session = _get_rembg_session()

    # 读取原图
    img = Image.open(image_path).convert("RGBA")
    w, h = img.size
    print(f"  📷 原图尺寸: {w}x{h}")

    # Rembg 处理
    from rembg import remove

    t0 = time.time()
    # remove 返回 RGBA PNG 字节，alpha 通道即前景 mask
    result_bytes = remove(img, session=session)
    elapsed = time.time() - t0
    print(f"  ✅ Rembg 处理完成，耗时 {elapsed:.1f}s")

    # 转 numpy
    if isinstance(result_bytes, (bytes, bytearray)):
        # 如果返回字节，先转 PIL
        from io import BytesIO
        result_img = Image.open(BytesIO(result_bytes)).convert("RGBA")
    elif isinstance(result_bytes, Image.Image):
        result_img = result_bytes.convert("RGBA")
    else:
        # 新版 rembg 可能直接返回 ndarray
        result_img = Image.fromarray(result_bytes).convert("RGBA")

    # 尺寸可能被 rembg 调整，确保和原图一致
    if result_img.size != (w, h):
        result_img = result_img.resize((w, h), Image.LANCZOS)

    # alpha 通道 = 前景 mask
    alpha = np.array(result_img.split()[-1])
    mask = alpha > 30  # 二值化（阈值 30，过滤边缘半透明噪声）

    # 保存结果（便于调试）
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # 保存前景透明图（对应百度的 foreground）
    fg_file = output_path / "rembg_foreground.png"
    result_img.save(fg_file)
    print(f"  ✅ 前景透明图已保存: {fg_file.name}")

    # 保存二值 mask（对应百度的 labelmap）
    mask_file = output_path / "rembg_labelmap.png"
    Image.fromarray((mask * 255).astype(np.uint8), mode="L").save(mask_file)
    print(f"  ✅ 二值 mask 已保存: {mask_file.name}")

    print(f"  ✅ 前景 mask: {mask.sum()} 像素 ({mask.sum() / (w*h) * 100:.1f}%)")
    return mask


def test_rembg_segmentation():
    """快速测试函数"""
    import sys

    if len(sys.argv) > 1:
        image_path = sys.argv[1]
    else:
        image_path = "test_images/sample.png"

    if not os.path.exists(image_path):
        print(f"❌ 测试图片不存在: {image_path}")
        return None

    output_dir = os.path.join("test_output", "rembg")
    mask = get_foreground_mask(image_path, output_dir)
    print(f"\n结果保存在: {output_dir}")
    return mask


if __name__ == "__main__":
    test_rembg_segmentation()
