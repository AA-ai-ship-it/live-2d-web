"""
本地 Inpainting 后端（替代通义万相 API，零审查、零费用）

支持两种后端：
1. OpenCV Inpainting (默认) — 本地 CPU，快速，适合小面积缺失
   - TELEA: 基于快速行进法，适合纹理平滑区域
   - NS: 基于 Navier-Stokes，适合保持边缘

2. AutoDL LaMa API (可选) — GPU 跑 LaMa 模型，质量更高（后续部署 endpoint 后启用）
   - endpoint: /api/inpaint (POST multipart: image, mask)

调用入口：
    result = inpaint(image_path, mask_path, output_path,
                     backend='opencv', method='telea', radius=5)
"""

import os
import time
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image


# ========================
# OpenCV Inpainting
# ========================

def _inpaint_opencv(
    image_rgb: np.ndarray,
    mask_uint8: np.ndarray,
    method: str = 'telea',
    radius: int = 5,
) -> np.ndarray:
    """
    OpenCV Inpainting 核心逻辑

    Args:
        image_rgb: H×W×3  uint8 原图（RGB 顺序）
        mask_uint8: H×W  uint8 二值 mask（255=需修复区域）
        method: 'telea' | 'ns'
        radius: 邻域半径（像素），默认 5

    Returns:
        inpainted H×W×3 uint8 RGB 图像
    """
    import cv2

    if method == 'telea':
        flag = cv2.INPAINT_TELEA
    elif method == 'ns':
        flag = cv2.INPAINT_NS
    else:
        raise ValueError(f'未知 inpaint method: {method}，可选 telea / ns')

    # cv2.inpaint 要求：mask 必须是 uint8 单通道，0 表示正常，非 0 表示修复
    result_bgr = cv2.inpaint(
        cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR),
        mask_uint8,
        inpaintRadius=radius,
        flags=flag,
    )
    return cv2.cvtColor(result_bgr, cv2.COLOR_BGR2RGB)


def _dilate_mask(mask_uint8: np.ndarray, radius: int = 3) -> np.ndarray:
    """膨胀 mask，保证缺失区域周边也被纳入修复（避免接缝）"""
    import cv2
    if radius <= 0:
        return mask_uint8
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
    return cv2.dilate(mask_uint8, kernel, iterations=1)


# ========================
# AutoDL SD Inpainting API
# ========================

def _inpaint_autodl_api(
    image_rgb: np.ndarray,
    mask_uint8: np.ndarray,
    endpoint: str,
    layer_name: str = 'general',
    strength: float = 0.85,
    steps: int = 25,
    guidance_scale: float = 7.5,
    fallback_to_opencv: bool = True,
) -> np.ndarray:
    """
    调用 AutoDL 后端的 SD Inpainting API（/api/inpaint）

    Args:
        image_rgb: H×W×3 uint8 原图
        mask_uint8: H×W uint8 二值 mask（255=修复区域）
        endpoint: 完整 API 地址，如 https://xxx/api/inpaint 或 AutoDL base URL（自动补 /api/inpaint）
        layer_name: 图层名（传给后端生成风格 prompt）
        strength / steps / guidance_scale: SD 参数
        fallback_to_opencv: 若 HTTP 调用失败，自动降级到 OpenCV

    Returns:
        H×W×3 uint8 RGB 图像
    """
    import io
    import requests as _requests

    # 补齐 endpoint 路径
    base = endpoint.rstrip('/')
    if not base.endswith('/api/inpaint'):
        base = base.rstrip('/') + '/api/inpaint'

    # 把 image 和 mask 转成 PNG 字节流
    img_pil = Image.fromarray(image_rgb, mode='RGB')
    mask_pil = Image.fromarray(mask_uint8, mode='L')
    img_buf = io.BytesIO()
    img_pil.save(img_buf, format='PNG')
    mask_buf = io.BytesIO()
    mask_pil.save(mask_buf, format='PNG')
    img_buf.seek(0)
    mask_buf.seek(0)

    try:
        t0 = time.time()
        print(f'  🌐 调用 AutoDL inpaint: {base}')
        resp = _requests.post(
            base,
            files={
                'image': ('image.png', img_buf, 'image/png'),
                'mask': ('mask.png', mask_buf, 'image/png'),
            },
            data={
                'layer_name': layer_name,
                'strength': str(strength),
                'num_inference_steps': str(steps),
                'guidance_scale': str(guidance_scale),
            },
            timeout=300,  # SD 推理 + 下载模型 可能慢
            # AutoDL 自签证书
            verify=False,
        )
        print(f'  🌐 HTTP {resp.status_code} ({time.time()-t0:.1f}s)')

        if resp.status_code == 409:
            raise RuntimeError('GPU 正忙（see-through 推理中）')
        if resp.status_code != 200:
            err_text = resp.text[:300]
            raise RuntimeError(f'HTTP {resp.status_code}: {err_text}')

        result_pil = Image.open(io.BytesIO(resp.content)).convert('RGB')
        # 尺寸对齐
        target_h, target_w = image_rgb.shape[:2]
        if result_pil.size != (target_w, target_h):
            result_pil = result_pil.resize((target_w, target_h), Image.LANCZOS)
        return np.array(result_pil)

    except Exception as e:
        print(f'  ❌ AutoDL inpaint 失败: {e}')
        if fallback_to_opencv:
            print('  🛟 降级到 OpenCV inpainting')
            return _inpaint_opencv(image_rgb, mask_uint8, method='telea', radius=7)
        raise


# ========================
# 统一入口
# ========================

def inpaint(
    image_path: str,
    mask_path: str,
    output_path: str,
    backend: str = 'opencv',
    method: str = 'telea',
    radius: int = 5,
    dilate_radius: int = 3,
    endpoint: Optional[str] = None,
    # AutoDL SD inpainting 专用参数
    layer_name: str = 'general',
    strength: float = 0.85,
    steps: int = 25,
    guidance_scale: float = 7.5,
    fallback_to_opencv: bool = True,
) -> dict:
    """
    执行 inpainting

    Args:
        image_path: 原图路径（RGB/RGBA 均可）
        mask_path:  mask 路径（uint8 二值，255=需修复）
        output_path: 输出结果路径（PNG，RGBA，保留原图 alpha）
        backend: 'opencv' | 'autodl'
        method: opencv 后端时选 'telea' | 'ns'
        radius: opencv inpaintRadius（邻域大小）
        dilate_radius: mask 膨胀半径（保证覆盖边缘，0=不膨胀）
        endpoint: AutoDL API 地址（如 https://xxx 或 https://xxx/api/inpaint）
        layer_name: 图层名（AutoDL 后端用，生成风格 prompt）
        strength / steps / guidance_scale: SD inpainting 参数
        fallback_to_opencv: AutoDL 调用失败时自动降级 OpenCV

    Returns:
        {success, result_path, elapsed, error, skipped}
    """
    t0 = time.time()

    try:
        # 1. 加载原图
        pil_img = Image.open(image_path).convert('RGBA')
        alpha = np.array(pil_img.split()[3])  # 保留原 alpha
        img_rgb = np.array(pil_img.convert('RGB'))
        h, w = img_rgb.shape[:2]

        # 2. 加载 mask
        pil_mask = Image.open(mask_path).convert('L')
        if pil_mask.size != (w, h):
            pil_mask = pil_mask.resize((w, h), Image.LANCZOS)
        mask_arr = np.array(pil_mask)

        # 3. 二值化（兼容百度 0/1 labelmap）
        maxv = int(mask_arr.max())
        minv = int(mask_arr.min())
        if maxv == 0:
            print('  ⏭️  mask 全黑，跳过 inpainting')
            _save_preserve_alpha(img_rgb, alpha, output_path)
            return {
                'success': True,
                'result_path': output_path,
                'elapsed': time.time() - t0,
                'skipped': True,
                'reason': 'mask 全空',
            }
        if maxv <= 1 and minv == 0:
            mask_bin = (mask_arr > 0).astype(np.uint8) * 255
        else:
            mask_bin = (mask_arr > 128).astype(np.uint8) * 255

        missing_px = int((mask_bin > 0).sum())
        if missing_px < 20:
            print(f'  ⏭️  缺失像素 {missing_px} < 20，跳过 inpainting')
            _save_preserve_alpha(img_rgb, alpha, output_path)
            return {
                'success': True,
                'result_path': output_path,
                'elapsed': time.time() - t0,
                'skipped': True,
                'reason': '缺失面积太小',
            }

        print(f'  🎨 inpainting: 缺失像素 {missing_px}，半径={radius}，膨胀={dilate_radius}')

        # 4. mask 膨胀（扩大修复范围，避免边缘接缝）
        mask_dilated = _dilate_mask(mask_bin, dilate_radius)

        # 5. 执行 inpainting
        if backend == 'opencv':
            result_rgb = _inpaint_opencv(img_rgb, mask_dilated, method=method, radius=radius)
        elif backend == 'autodl':
            if not endpoint:
                raise ValueError('backend=autodl 需要提供 endpoint 参数（AutoDL URL）')
            result_rgb = _inpaint_autodl_api(
                img_rgb, mask_dilated,
                endpoint=endpoint,
                layer_name=layer_name,
                strength=strength,
                steps=steps,
                guidance_scale=guidance_scale,
                fallback_to_opencv=fallback_to_opencv,
            )
        else:
            raise ValueError(f'未知 backend: {backend}，可选 opencv / autodl')

        # 6. 只在 mask 覆盖区域替换原图内容（其余区域保持原图不变，防止 inpainting 破坏已正确的像素）
        replace_mask = (mask_dilated > 0)[:, :, None]
        result_rgb = np.where(replace_mask, result_rgb, img_rgb)

        # 7. 保存（保留原 alpha）
        _save_preserve_alpha(result_rgb, alpha, output_path)

        elapsed = time.time() - t0
        print(f'  ✅ inpainting 完成，耗时 {elapsed:.1f}s')
        return {
            'success': True,
            'result_path': output_path,
            'elapsed': elapsed,
            'skipped': False,
        }

    except Exception as e:
        elapsed = time.time() - t0
        print(f'  ❌ inpainting 失败: {e}')
        return {
            'success': False,
            'error': str(e),
            'elapsed': elapsed,
        }


def _save_preserve_alpha(rgb_uint8: np.ndarray, alpha_uint8: np.ndarray, output_path: str):
    """合成 RGBA 并保存为 PNG"""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    if rgb_uint8.shape[2] != 3:
        raise ValueError(f'rgb_uint8 需是 HxWx3，当前 {rgb_uint8.shape}')
    if alpha_uint8.shape[:2] != rgb_uint8.shape[:2]:
        raise ValueError('alpha 尺寸与 RGB 不一致')

    h, w = rgb_uint8.shape[:2]
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, :3] = rgb_uint8
    rgba[:, :, 3] = alpha_uint8
    Image.fromarray(rgba, mode='RGBA').save(output_path, 'PNG')
