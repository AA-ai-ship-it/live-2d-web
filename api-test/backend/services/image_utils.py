"""
图片处理工具
- mask 转透明彩色图层
- 边界框计算
- 图层裁剪
- 差集计算（前景 - 子区域 = 剩余部分）
"""

from PIL import Image
import numpy as np
import os
from pathlib import Path
from typing import Optional, Tuple, List


def mask_to_transparent(original_path: str, mask_path: str, output_path: str) -> bool:
    """
    将黑白 mask 转换为透明背景彩色图层
    white(255) = 不透明, black(0) = 透明
    兼容 mask 值为 0/1 的情况（百度 AI labelmap 格式），会自动归一化到 0/255
    """
    try:
        original = Image.open(original_path).convert('RGBA')
        mask = Image.open(mask_path).convert('L')

        if original.size != mask.size:
            mask = mask.resize(original.size, Image.LANCZOS)

        # 归一化 mask（百度 AI 的 labelmap 可能是 0/1 而不是 0/255）
        mask_arr = np.array(mask)
        maxv = int(mask_arr.max())
        minv = int(mask_arr.min())
        if 0 < maxv < 128 and minv == 0:
            mask_arr = (mask_arr > 0).astype(np.uint8) * 255
            mask = Image.fromarray(mask_arr, mode='L')
        elif maxv > 0:
            # 常规低值阈值化
            mask_arr = np.where(mask_arr > 10, 255, 0).astype(np.uint8)
            mask = Image.fromarray(mask_arr, mode='L')

        original.putalpha(mask)
        original.save(output_path, 'PNG')
        return True
    except Exception as e:
        print(f"  [image_utils] mask_to_transparent 失败: {e}")
        return False


def compute_bbox_from_alpha(image_path: str, threshold: int = 10) -> Optional[dict]:
    """
    从透明图层的 alpha 通道计算边界框
    返回 {left, top, width, height}，全透明时返回 None
    """
    try:
        img = Image.open(image_path).convert('RGBA')
        alpha = np.array(img.split()[-1])  # alpha 通道

        # 找到非透明像素
        mask = alpha > threshold
        if not mask.any():
            return None

        rows = np.any(mask, axis=1)
        cols = np.any(mask, axis=0)
        top, bottom = np.where(rows)[0][[0, -1]]
        left, right = np.where(cols)[0][[0, -1]]

        return {
            'left': int(left),
            'top': int(top),
            'width': int(right - left + 1),
            'height': int(bottom - top + 1),
        }
    except Exception as e:
        print(f"  [image_utils] compute_bbox 失败: {e}")
        return None


def crop_to_bbox(image_path: str, output_path: str, bbox: dict, padding: int = 0) -> bool:
    """
    裁剪透明图层到边界框（减少图层体积）
    padding: 向外扩展的像素数
    """
    try:
        img = Image.open(image_path).convert('RGBA')
        w, h = img.size

        left = max(0, bbox['left'] - padding)
        top = max(0, bbox['top'] - padding)
        right = min(w, bbox['left'] + bbox['width'] + padding)
        bottom = min(h, bbox['top'] + bbox['height'] + padding)

        cropped = img.crop((left, top, right, bottom))
        cropped.save(output_path, 'PNG')
        return True
    except Exception as e:
        print(f"  [image_utils] crop_to_bbox 失败: {e}")
        return False


def compute_difference_layer(
    original_path: str,
    foreground_mask_path: str,
    subtraction_mask_paths: List[str],
    output_path: str
) -> bool:
    """
    计算差集图层：前景 mask - 多个子 mask = 剩余部分（如头发）
    所有 mask 尺寸自动对齐到原图
    """
    try:
        original = Image.open(original_path).convert('RGBA')
        w, h = original.size

        # 加载前景 mask
        fg_mask = Image.open(foreground_mask_path).convert('L')
        if fg_mask.size != (w, h):
            fg_mask = fg_mask.resize((w, h), Image.LANCZOS)
        fg_arr = np.array(fg_mask) > 128

        # 减去所有子 mask
        for sub_path in subtraction_mask_paths:
            if not os.path.exists(sub_path):
                continue
            sub_mask = Image.open(sub_path).convert('L')
            if sub_mask.size != (w, h):
                sub_mask = sub_mask.resize((w, h), Image.LANCZOS)
            sub_arr = np.array(sub_mask) > 128
            fg_arr = fg_arr & (~sub_arr)

        # 转回 PIL 并应用为 alpha
        diff_mask = Image.fromarray((fg_arr * 255).astype(np.uint8), mode='L')
        original.putalpha(diff_mask)
        original.save(output_path, 'PNG')
        return True
    except Exception as e:
        print(f"  [image_utils] compute_difference 失败: {e}")
        return False


def extract_alpha_mask(image_path: str, output_path: str, threshold: int = 10) -> bool:
    """
    从透明图层的 alpha 通道提取黑白 mask
    用于替代百度 labelmap（当前景透明图有 alpha 通道时）
    white(255) = 人物区域, black(0) = 背景
    """
    try:
        import numpy as np
        img = Image.open(image_path).convert('RGBA')
        alpha = img.split()[-1]
        arr = np.array(alpha)
        # 二值化：alpha > threshold → 255(白), 否则 → 0(黑)
        mask = Image.fromarray(((arr > threshold) * 255).astype(np.uint8), mode='L')
        mask.save(output_path)
        return True
    except Exception as e:
        print(f"  [image_utils] extract_alpha_mask 失败: {e}")
        return False


def get_image_size(image_path: str) -> Tuple[int, int]:
    """获取图片尺寸"""
    try:
        with Image.open(image_path) as img:
            return img.size
    except Exception:
        return (0, 0)


def save_upload_image(upload_data: bytes, output_path: str) -> Tuple[int, int]:
    """
    保存上传的图片，返回尺寸 (width, height)
    统一转为 PNG 格式
    """
    from io import BytesIO
    img = Image.open(BytesIO(upload_data))
    if img.mode not in ('RGBA', 'RGB'):
        img = img.convert('RGBA')
    elif img.mode == 'RGB':
        img = img.convert('RGBA')

    img.save(output_path, 'PNG')
    return img.size


def fill_mask_holes(mask_path: str, output_path: str, max_hole_area: int = 5000) -> bool:
    """
    填充二值 mask 中的孔洞（前景内部的小空隙）
    用于修复百度分割把手臂间空隙误判为背景的问题

    原理：反转 mask（前景变背景，背景变前景），
    找出被前景包围的背景区域（孔洞），填充为前景

    Args:
        mask_path: 输入二值 mask 路径
        output_path: 输出 mask 路径
        max_hole_area: 最大孔洞面积（像素），超过则不填充
    """
    try:
        from scipy import ndimage
        mask = Image.open(mask_path).convert('L')
        arr = np.array(mask)
        # 二值化：百度 labelmap 可能是 0/1 而不是 0/255，
        # 用 >0 阈值保证任何非 0 都算前景（同时避免轻微噪点影响）
        maxv = int(arr.max())
        if maxv == 1:                       # 百度 AI 特有的 0/1 输出
            binary = arr > 0
        elif maxv <= 10:                    # 其他低值 mask，也按非零判真
            binary = arr > 0
        else:                               # 常规 0/255 mask，保守阈值 128
            binary = arr > 128

        # 反转：True = 孔洞候选（原背景）
        inverted = ~binary

        # 标记连通区域
        labeled, num_features = ndimage.label(inverted)

        # 找出真正的背景区域（接触图片边缘的）
        edge_labels = set()
        edge_labels.update(labeled[0, :].tolist())      # 上边
        edge_labels.update(labeled[-1, :].tolist())     # 下边
        edge_labels.update(labeled[:, 0].tolist())      # 左边
        edge_labels.update(labeled[:, -1].tolist())     # 右边
        edge_labels.discard(0)  # 0 是前景

        # 非边缘区域 = 孔洞（被前景包围的背景）
        holes = np.zeros_like(binary)
        for i in range(1, num_features + 1):
            if i not in edge_labels:
                area = np.sum(labeled == i)
                if area <= max_hole_area:
                    holes[labeled == i] = True

        # 填充孔洞
        filled = binary | holes
        result = Image.fromarray((filled * 255).astype(np.uint8), mode='L')
        result.save(output_path)

        hole_count = np.sum(holes)
        print(f"  [fill_mask_holes] 填充 {hole_count} 个像素的孔洞")
        return True
    except ImportError:
        print("  [fill_mask_holes] scipy 未安装，跳过填洞处理")
        # 备用方案：用形态学闭运算
        return _fill_holes_morphology(mask_path, output_path)
    except Exception as e:
        print(f"  [fill_mask_holes] 失败: {e}")
        return False


def _fill_holes_morphology(mask_path: str, output_path: str) -> bool:
    """备用方案：用形态学闭运算填洞（需要较小孔洞）"""
    try:
        mask = Image.open(mask_path).convert('L')
        arr = np.array(mask)
        binary = arr > 128

        # 多次膨胀再腐蚀（闭运算）填小洞
        from PIL import ImageFilter
        img = Image.fromarray((binary * 255).astype(np.uint8), mode='L')
        # 膨胀（最大值滤波）后腐蚀（最小值滤波）
        for _ in range(3):
            img = img.filter(ImageFilter.MaxFilter(5))
        for _ in range(3):
            img = img.filter(ImageFilter.MinFilter(5))

        img.save(output_path)
        return True
    except Exception:
        return False


def remove_dark_pixels_from_alpha(
    image_path: str, output_path: str,
    dark_threshold: int = 15,
    edge_only: bool = False
) -> bool:
    """
    去除透明图层中 RGB 接近黑色的像素（如手臂间空隙的黑块）
    仅处理 alpha>0 的像素中的深色像素

    Args:
        image_path: 输入 RGBA 图片
        output_path: 输出图片
        dark_threshold: RGB 值低于此值视为黑色（0-255）
        edge_only: True 只处理被前景包围的黑色区域（更安全）
    """
    try:
        img = Image.open(image_path).convert('RGBA')
        arr = np.array(img)

        # 找出 RGB 接近黑色的像素
        rgb = arr[:, :, :3]
        dark_mask = np.all(rgb < dark_threshold, axis=2)

        if not edge_only:
            # 直接将这些像素设为透明
            arr[dark_mask, 3] = 0
        else:
            # 只处理被前景包围的黑色区域（不接触图片边缘的）
            from scipy import ndimage
            labeled, num = ndimage.label(dark_mask)
            if num > 0:
                edge_labels = set()
                edge_labels.update(labeled[0, :].tolist())
                edge_labels.update(labeled[-1, :].tolist())
                edge_labels.update(labeled[:, 0].tolist())
                edge_labels.update(labeled[:, -1].tolist())
                edge_labels.discard(0)
                for i in range(1, num + 1):
                    if i not in edge_labels:
                        arr[labeled == i, 3] = 0

        result = Image.fromarray(arr, mode='RGBA')
        result.save(output_path)

        removed = np.sum(arr[:, :, 3] == 0) - np.sum(dark_mask if not edge_only else np.zeros_like(dark_mask))
        print(f"  [remove_dark] 处理完成")
        return True
    except Exception as e:
        print(f"  [remove_dark] 失败: {e}")
        return False


def filter_layer_by_vertical_range(
    image_path: str, output_path: str,
    top_ratio: float = 0.0, bottom_ratio: float = 0.4
) -> bool:
    """
    按垂直位置过滤图层内容（只保留指定纵向范围内的像素）
    用于头发图层：只保留图片上部区域，去除混入的眼睛/配饰等

    Args:
        image_path: 输入 RGBA 图层
        output_path: 输出图层
        top_ratio: 保留区域顶部（0=图片顶部）
        bottom_ratio: 保留区域底部（0.4=图片40%处）
    """
    try:
        img = Image.open(image_path).convert('RGBA')
        w, h = img.size
        arr = np.array(img)

        top_y = int(h * top_ratio)
        bottom_y = int(h * bottom_ratio)

        # 将范围外的像素设为透明
        # 上方
        if top_y > 0:
            arr[:top_y, :, 3] = 0
        # 下方
        if bottom_y < h:
            arr[bottom_y:, :, 3] = 0

        result = Image.fromarray(arr, mode='RGBA')
        result.save(output_path)
        print(f"  [filter_vertical] 保留 y={top_y}-{bottom_y} (图片高{h})")
        return True
    except Exception as e:
        print(f"  [filter_vertical] 失败: {e}")
        return False
