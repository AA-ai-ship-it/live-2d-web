"""
A+B 修补流程脚本（海外版）
策略 A：Rembg 前景差集（Rembg 返回完整前景 → 与分层合并结果差集 → 缺失区域）
策略 B：单图层修补（每个图层独立调用本地 inpainting 或 SD Inpainting）

海外版变更：
- 策略 A：百度 AI → Rembg（本地运行，零费用，海外可用，无审查）
- 策略 B：通义万相 → OpenCV 本地 inpainting / RunPod SD Inpainting（移除国内 API 依赖）

完整流程：
1. 加载 see-through / 规则引擎 分层结果
2. 合并所有图层 mask
3. Rembg → 完整前景 mask
4. 差集 = Rembg 前景 - 合并图层 = 真正缺失区域
5. 把缺失区域按位置分配给对应图层
6. 每个图层修补（默认 OpenCV 本地 inpainting，零审查零费用；可选 SD Inpainting）
7. 从修补结果中提取对应图层

使用方式：
  python inpaint_pipeline.py --task_dir backend/workspace/d97d328d --skip_inpaint  # 预览
  python inpaint_pipeline.py --task_dir backend/workspace/d97d328d                 # 完整修补（OpenCV）
  python inpaint_pipeline.py --task_dir backend/workspace/d97d328d --backend sd    # 用 SD Inpainting（需 --endpoint）
"""

import os
import sys
import time
import json
import argparse
from pathlib import Path

# 添加路径
_API_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
if _API_TEST_DIR not in sys.path:
    sys.path.insert(0, _API_TEST_DIR)

import numpy as np
from PIL import Image

# 海外版依赖：Rembg 替代百度分割
from rembg_segmentation import get_foreground_mask as get_rembg_foreground_mask
from backend.services.image_utils import fill_mask_holes


# ========================
# 步骤 1：加载分层结果
# ========================

def load_layers_from_task(task_dir: str) -> dict:
    """
    从任务目录加载分层结果
    自动检测 see-through 输出（output/input/ 多部位 PNG）或规则引擎输出（layer_*.png）

    Returns:
        {
            image_path: str,          # 原图路径
            layers: [                 # 图层列表
                {
                    name: str,        # 图层名（如 hair/skin/clothes/foreground 或 front hair/back hair/neck 等）
                    path: str,        # RGBA 图层文件路径
                    mask: np.ndarray, # 二值 mask（H,W）bool
                }
            ]
        }
    """
    task_dir = Path(task_dir)
    output_dir = task_dir / 'output'
    image_path = str(task_dir / 'input.png')

    if not os.path.exists(image_path):
        raise FileNotFoundError(f'找不到原图: {image_path}')

    layers = []

    # 优先检测 see-through 格式：output/input/ 目录下的部位 PNG
    seethrough_dir = output_dir / 'input'
    if seethrough_dir.exists() and seethrough_dir.is_dir():
        print(f"  📁 检测到 see-through 格式: {seethrough_dir}")

        # 需要排除的非图层文件
        exclude_names = {'src_img', 'src_head', 'reconstruction'}

        for png_file in sorted(seethrough_dir.glob('*.png')):
            stem = png_file.stem  # 文件名（不含扩展名）

            # 排除深度图（_depth 后缀）和非图层文件
            if stem.endswith('_depth') or stem in exclude_names:
                continue

            try:
                img = Image.open(png_file).convert('RGBA')
                alpha = np.array(img.split()[-1])
                mask = alpha > 10  # 二值化

                # 跳过全透明图层
                if mask.sum() == 0:
                    print(f"  ⏭️  跳过空图层: {stem}")
                    continue

                layers.append({
                    'name': stem,
                    'path': str(png_file),
                    'mask': mask,
                    'size': img.size,
                })
                print(f"  ✅ 加载图层: {stem} ({img.size}, 非透明像素 {mask.sum()})")
            except Exception as e:
                print(f"  ⚠️ 加载失败 {stem}: {e}")

    # 回退到规则引擎格式：output/ 目录下的 layer_*.png
    if not layers:
        print(f"  📁 检测规则引擎格式: {output_dir}")
        layer_files = {
            'hair': 'layer_hair.png',
            'skin': 'layer_skin.png',
            'clothes': 'layer_clothes.png',
            'foreground': 'layer_foreground.png',
        }

        for name, filename in layer_files.items():
            path = output_dir / filename
            if path.exists():
                img = Image.open(path).convert('RGBA')
                alpha = np.array(img.split()[-1])
                mask = alpha > 10  # 二值化
                layers.append({
                    'name': name,
                    'path': str(path),
                    'mask': mask,
                    'size': img.size,
                })
                print(f"  ✅ 加载图层: {name} ({img.size}, 非透明像素 {mask.sum()})")

    if not layers:
        raise FileNotFoundError(f'任务目录中未找到图层文件: {output_dir}')

    print(f"  📊 共加载 {len(layers)} 个图层")
    return {
        'image_path': image_path,
        'layers': layers,
    }


# ========================
# 步骤 2：合并所有图层 mask
# ========================

def merge_layer_masks(layers: list, image_size: tuple) -> np.ndarray:
    """
    合并所有图层的 mask（并集）
    用于与百度前景做差集
    """
    w, h = image_size
    merged = np.zeros((h, w), dtype=bool)

    for layer in layers:
        mask = layer['mask']
        if mask.shape != (h, w):
            # 尺寸对齐
            mask_img = Image.fromarray((mask * 255).astype(np.uint8), mode='L')
            mask_img = mask_img.resize((w, h), Image.LANCZOS)
            mask = np.array(mask_img) > 128
        merged = merged | mask

    print(f"  ✅ 合并图层 mask: {merged.sum()} 像素")
    return merged


# ========================
# 步骤 3：Rembg 前景分割（替代百度 AI）
# ========================

def get_foreground_mask(image_path: str, output_dir: str) -> np.ndarray:
    """
    调用 Rembg 前景分割，返回完整前景的二值 mask
    （海外版：替代百度 AI，本地运行零费用）
    """
    mask = get_rembg_foreground_mask(image_path, output_dir)

    # 填洞（修复手臂间空隙，与百度版本保持一致的处理逻辑）
    filled_path = os.path.join(output_dir, 'fg_mask_filled.png')
    Image.fromarray((mask * 255).astype(np.uint8), mode='L').save(filled_path)
    fill_mask_holes(filled_path, filled_path)

    filled = Image.open(filled_path).convert('L')
    mask = np.array(filled) > 128

    print(f"  ✅ Rembg 前景 mask（填洞后）: {mask.sum()} 像素")
    return mask


# ========================
# 步骤 4：差集 = 前景 - 合并图层 = 缺失区域
# ========================

def compute_missing_mask(fg_mask: np.ndarray, merged_layer_mask: np.ndarray) -> np.ndarray:
    """
    差集 = 完整前景 - 分层合并结果 = 真正缺失的区域
    """
    # 尺寸对齐
    if fg_mask.shape != merged_layer_mask.shape:
        h, w = fg_mask.shape
        merged_img = Image.fromarray((merged_layer_mask * 255).astype(np.uint8), mode='L')
        merged_img = merged_img.resize((w, h), Image.LANCZOS)
        merged_layer_mask = np.array(merged_img) > 128

    missing = fg_mask & (~merged_layer_mask)
    print(f"  ✅ 缺失区域: {missing.sum()} 像素 ({missing.sum() / fg_mask.sum() * 100:.1f}%)")
    return missing


# ========================
# 步骤 5：把缺失区域分配给对应图层
# ========================

def assign_missing_to_layers(missing_mask: np.ndarray, layers: list) -> dict:
    """
    把缺失区域分配给对应图层（通用策略，不依赖固定图层名）

    分配策略：
    1. 对每个图层的 alpha mask 做形态学膨胀（扩展 25 像素）
    2. 缺失像素优先分配给膨胀 mask 包含它的图层（多个则选 alpha 像素最多的）
    3. 未分配的像素按距离变换找最近的图层
    """
    from scipy import ndimage

    h, w = missing_mask.shape
    n_layers = len(layers)

    if n_layers == 0:
        return {}

    print(f"  📊 分配缺失区域到 {n_layers} 个图层...")

    # 1. 计算每个图层的膨胀 mask 和像素数
    dilated_masks = []
    pixel_counts = []
    for layer in layers:
        mask = layer['mask']
        # 尺寸对齐
        if mask.shape != (h, w):
            mask_img = Image.fromarray((mask * 255).astype(np.uint8), mode='L')
            mask_img = mask_img.resize((w, h), Image.LANCZOS)
            mask = np.array(mask_img) > 128

        # 形态学膨胀（扩展 25 像素，覆盖缺失的边界区域）
        dilated = ndimage.binary_dilation(mask, iterations=25)
        dilated_masks.append(dilated)
        pixel_counts.append(int(mask.sum()))

    # 2. 为每个缺失像素分配图层
    # 用 label map：每个像素标记所属图层索引（-1 = 未分配）
    label_map = np.full((h, w), -1, dtype=np.int32)

    for i, dilated in enumerate(dilated_masks):
        # 该图层的膨胀区域内的缺失像素
        region = missing_mask & dilated & (label_map == -1)
        label_map[region] = i

    # 3. 未分配的像素按距离变换找最近的图层
    unassigned = missing_mask & (label_map == -1)
    if unassigned.any():
        print(f"  📍 {unassigned.sum()} 像素未在膨胀区域内，用距离变换分配...")

        # 计算每个图层到所有像素的距离变换
        min_dist = np.full((h, w), np.inf)
        best_layer = np.full((h, w), -1, dtype=np.int32)

        for i, mask in enumerate([l['mask'] if l['mask'].shape == (h, w) else
                                   np.array(Image.fromarray((l['mask'] * 255).astype(np.uint8), mode='L').resize((w, h), Image.LANCZOS)) > 128
                                   for l in layers]):
            if not mask.any():
                continue
            # 距离变换：每个像素到最近前景像素的距离
            dist = ndimage.distance_transform_edt(~mask)
            update = dist < min_dist
            min_dist[update] = dist[update]
            best_layer[update] = i

        # 只更新未分配的缺失像素
        label_map[unassigned] = best_layer[unassigned]

    # 4. 按 label_map 生成分配结果
    assignments = {}
    for i, layer in enumerate(layers):
        layer_mask = (label_map == i) & missing_mask
        if layer_mask.sum() > 0:
            assignments[layer['name']] = layer_mask

    print(f"  ✅ 缺失区域分配:")
    for name, mask in assignments.items():
        print(f"     {name}: {mask.sum()} 像素")

    return assignments


# ========================
# 步骤 6：单图层修补（OpenCV / SD Inpainting）
# ========================

def _get_layer_prompt(layer_name: str) -> str:
    """根据图层名生成修补 prompt（英文，用于 SD Inpainting）"""
    name_lower = layer_name.lower()

    # 规则引擎格式
    prompt_map = {
        'hair': 'inpaint anime character hair, preserve color and style',
        'skin': 'inpaint anime character skin, preserve natural tone',
        'clothes': 'inpaint anime character clothing, preserve style and color',
        'foreground': 'inpaint anime character body, preserve original style',
    }
    if layer_name in prompt_map:
        return prompt_map[layer_name]

    # see-through 格式：按优先级匹配（避免 ear 匹配到 wear）
    # 优先级：hair > *wear（衣物类）> 五官眼耳口鼻 > 四肢 > 其他
    if 'hair' in name_lower:
        return 'inpaint anime character hair, preserve color and style'
    if name_lower.endswith('wear') or 'topwear' in name_lower or 'bottomwear' in name_lower:
        return 'inpaint anime character clothing/accessory, preserve style and color'
    if any(k in name_lower for k in ['face', 'head', 'nose', 'mouth', 'neck']):
        return 'inpaint anime character face/head/neck, preserve features and skin tone'
    if any(k in name_lower for k in ['eye', 'iris', 'eyebrow', 'eyelash', 'eyewhite']):
        return 'inpaint anime character eye region, preserve eye style and color'
    if any(k in name_lower for k in ['ear',]):
        # 必须在 *wear 之后，否则 earwear 会被误判
        return 'inpaint anime character ear, preserve skin tone'
    if any(k in name_lower for k in ['leg', 'foot', 'shoe']):
        return 'inpaint anime character leg/foot, preserve style'
    if any(k in name_lower for k in ['hand', 'arm']):
        return 'inpaint anime character arm/hand, preserve style'
    if any(k in name_lower for k in ['tail', 'wing', 'object']):
        return 'inpaint anime character accessory (tail/wings/object), preserve style'

    return 'inpaint missing region, preserve original style and color'


def inpaint_layer(
    image_path: str,
    missing_mask: np.ndarray,
    layer_name: str,
    output_dir: str,
    prompt: str = None,
    style: str = 'anime',
    max_wait: int = 120,
    backend: str = 'local',
    autodl_endpoint: str = None,
) -> dict:
    """
    修补单个图层
    - 原图 = 整个原图（提供完整上下文）
    - mask = 该图层对应的缺失区域（白色=需修补）
    - 修补后用该图层的 alpha mask 提取对应区域
    backend: local（OpenCV）/ sd（SD Inpainting，需 RunPod endpoint）
    """
    backend_label = {'local': 'OpenCV 本地', 'sd': 'SD Inpainting'}.get(backend, backend)
    print(f"\n[步骤6] {backend_label} inpainting 修补图层: {layer_name}")

    if missing_mask.sum() == 0:
        print(f"  ⚠️ {layer_name} 无缺失区域，跳过")
        return {'success': True, 'skipped': True, 'reason': '无缺失区域'}

    # 默认 prompt（仅 SD Inpainting 需要，OpenCV 不用）
    if prompt is None:
        prompt = _get_layer_prompt(layer_name)
    print(f"  📝 修补意图: {prompt}")

    os.makedirs(output_dir, exist_ok=True)

    # 1. 生成 mask 图（白色=需修补区域）
    mask_path = os.path.join(output_dir, f'mask_{layer_name}.png')
    w, h = missing_mask.shape[1], missing_mask.shape[0]
    mask_img = Image.fromarray((missing_mask * 255).astype(np.uint8), mode='L')
    mask_img.save(mask_path)

    # 2. 调用本地 inpainting（后端可切换）
    from local_inpainting import inpaint as local_inpaint_fn

    # 根据图层类型调整参数（半径越大越"糊"，越能补大范围）
    # 优先级同 _get_layer_prompt：先排除 *wear，再匹配五官
    name_lower = layer_name.lower()
    is_wear = name_lower.endswith('wear') or 'topwear' in name_lower or 'bottomwear' in name_lower
    if is_wear:
        # 衣物类：较大半径（颜色/纹理扩散）
        radius, dilate = 7, 5
    elif any(k in name_lower for k in ['hair', 'leg', 'foot', 'hand', 'arm', 'shoe', 'tail', 'wing', 'object']):
        # 头发/四肢/附属物：较大半径
        radius, dilate = 7, 5
    else:
        # 皮肤/脸部/五官/颈部：较小半径（保持细节）
        radius, dilate = 5, 2

    result_path = os.path.join(output_dir, f'inpaint_result_{layer_name}.png')

    # 选实际 backend
    # local_inpainting 内部用 'autodl' 标识 SD endpoint 调用
    if backend == 'local':
        actual_backend = 'opencv'
    elif backend == 'sd':
        actual_backend = 'autodl'
    else:
        actual_backend = 'opencv'

    # 强度参数（SD autodl 专用）
    # 皮肤/五官强度低一点避免"改脸"，衣物/头发可高
    if is_wear or any(k in name_lower for k in ['hair', 'tail', 'wing', 'object']):
        strength = 0.9
        steps = 25
    else:
        strength = 0.7
        steps = 20

    result = local_inpaint_fn(
        image_path=image_path,
        mask_path=mask_path,
        output_path=result_path,
        backend=actual_backend,
        method='telea',
        radius=radius,
        dilate_radius=dilate,
        endpoint=autodl_endpoint,
        layer_name=layer_name,
        strength=strength,
        steps=steps,
        guidance_scale=7.5,
        fallback_to_opencv=True,
    )

    if actual_backend == 'opencv' and not result.get('success'):
        # 自动降级到 NS 算法
        print(f"  ⚠️ Telea 失败，降级 NS 重试...")
        result = local_inpaint_fn(
            image_path=image_path,
            mask_path=mask_path,
            output_path=result_path,
            backend='opencv',
            method='ns',
            radius=radius,
            dilate_radius=dilate,
        )

    print(f"  ✅ {layer_name} 修补完成: {result_path}")
    return result


# ========================
# 步骤 7：从修补结果中提取图层
# ========================

def extract_layer_from_result(
    result_path: str,
    layer_mask: np.ndarray,
    output_path: str
) -> bool:
    """
    从通义万相修补结果中提取对应图层
    用该图层原有的 alpha mask 做提取
    """
    try:
        result_img = Image.open(result_path).convert('RGBA')
        w, h = result_img.size

        # 尺寸对齐
        if layer_mask.shape != (h, w):
            mask_img = Image.fromarray((layer_mask * 255).astype(np.uint8), mode='L')
            mask_img = mask_img.resize((w, h), Image.LANCZOS)
            layer_mask = np.array(mask_img) > 128

        # 应用 mask
        arr = np.array(result_img)
        arr[~layer_mask, 3] = 0  # 非该图层区域设为透明
        Image.fromarray(arr, mode='RGBA').save(output_path)

        print(f"  ✅ 图层提取完成: {output_path}")
        return True
    except Exception as e:
        print(f"  ❌ 图层提取失败: {e}")
        return False


# ========================
# 主流程
# ========================

def run_pipeline(task_dir: str, skip_inpaint: bool = False, backend: str = 'local',
                 autodl_endpoint: str = None, hybrid_threshold: int = 500) -> dict:
    """
    运行完整 A+B 修补流程

    Args:
        task_dir: 任务目录（包含 input.png 和 output/ 图层）
        skip_inpaint: True 只计算缺失区域，不调用 inpainting（用于预览）
        backend: inpainting 后端
            'local'    = OpenCV 本地 inpainting（默认，零审查零费用，快 ~2s）
            'sd'       = SD Inpainting（需 RunPod endpoint，质量更好 ~30s）
            'hybrid'   = 混合模式：缺失面积 >= threshold 用 SD，< threshold 用 OpenCV
        autodl_endpoint: SD Inpainting 地址，如 https://xxx/api/inpaint
                          也可通过环境变量 INPAINT_AUTODL_ENDPOINT 设置
        hybrid_threshold: hybrid 模式下的面积阈值（像素），默认 500
    """
    # 环境变量兜底
    if autodl_endpoint is None:
        autodl_endpoint = os.environ.get('INPAINT_AUTODL_ENDPOINT')
    if backend in ('sd', 'hybrid') and not autodl_endpoint:
        raise ValueError(f'backend={backend} 需要提供 --endpoint 或 INPAINT_AUTODL_ENDPOINT 环境变量')

    start_time = time.time()
    backend_label = {'local': 'OpenCV 本地 inpainting',
                     'sd': f'SD Inpainting ({autodl_endpoint})',
                     'hybrid': f'混合模式 (≥{hybrid_threshold}px 用SD, < 用OpenCV)'}.get(backend, backend)
    print(f"\n{'='*60}")
    print(f"A+B 修补流程（海外版）")
    print(f"策略 A: Rembg 前景差集")
    print(f"策略 B: 单图层修补（{backend_label}）")
    print(f"{'='*60}")

    # 步骤 1：加载分层结果
    print(f"\n[步骤1] 加载分层结果...")
    data = load_layers_from_task(task_dir)
    image_path = data['image_path']
    layers = data['layers']

    # 检测 see-through 格式：图层尺寸可能与原图不同（see-through 把原图 resize 到 768x768 画布）
    # 此时需要用 see-through 的 src_img.png 作为分割输入，保证尺寸一致
    original = Image.open(image_path)
    orig_size = original.size  # 原图尺寸

    # 检查是否有 see-through 的 src_img.png
    src_img_path = os.path.join(task_dir, 'output', 'input', 'src_img.png')
    if os.path.exists(src_img_path):
        src_img = Image.open(src_img_path).convert('RGBA')
        if src_img.size != orig_size:
            print(f"  ℹ️  检测到 see-through resize: 原图 {orig_size} → 图层 {src_img.size}")
            print(f"     使用 src_img.png 作为分割输入（保持尺寸一致）")
            seg_input_path = src_img_path
            image_size = src_img.size  # 用图层尺寸作为 mask 画布
        else:
            seg_input_path = image_path
            image_size = orig_size
    else:
        seg_input_path = image_path
        image_size = orig_size

    # 步骤 2：合并所有图层 mask
    print(f"\n[步骤2] 合并图层 mask...")
    merged_mask = merge_layer_masks(layers, image_size)

    # 保存合并结果用于预览
    output_dir = os.path.join(task_dir, 'output', 'inpaint')
    os.makedirs(output_dir, exist_ok=True)
    Image.fromarray((merged_mask * 255).astype(np.uint8), mode='L').save(
        os.path.join(output_dir, 'merged_layer_mask.png')
    )

    # 步骤 3：Rembg 前景分割（用 see-through 的 src_img 保证尺寸一致）
    rembg_dir = os.path.join(output_dir, 'rembg')
    os.makedirs(rembg_dir, exist_ok=True)
    fg_mask = get_foreground_mask(seg_input_path, rembg_dir)

    # 保存前景 mask
    Image.fromarray((fg_mask * 255).astype(np.uint8), mode='L').save(
        os.path.join(output_dir, 'fg_mask.png')
    )

    # 步骤 4：差集 = 前景 - 合并图层
    print(f"\n[步骤4] 计算缺失区域（差集）...")
    missing_mask = compute_missing_mask(fg_mask, merged_mask)

    # 保存缺失区域
    Image.fromarray((missing_mask * 255).astype(np.uint8), mode='L').save(
        os.path.join(output_dir, 'missing_mask.png')
    )

    # 步骤 5：分配缺失区域到各图层
    print(f"\n[步骤5] 分配缺失区域到各图层...")
    assignments = assign_missing_to_layers(missing_mask, layers)

    if skip_inpaint:
        print(f"\n⏭️  跳过修补（--skip_inpaint）")
        print(f"\n{'='*60}")
        print(f"预览结果已保存到: {output_dir}")
        print(f"  - merged_layer_mask.png  (分层合并结果)")
        print(f"  - fg_mask.png            (Rembg 完整前景)")
        print(f"  - missing_mask.png       (缺失区域)")
        return {'success': True, 'output_dir': output_dir, 'skipped': True}

    # 步骤 6+7：每个图层修补
    print(f"\n[步骤6+7] 修补各图层...")
    layer_by_name = {l['name']: l for l in layers}
    results = {}

    # 最小缺失面积阈值（像素），低于此值跳过修补
    MIN_MISSING_AREA = 200

    for layer_name, missing in assignments.items():
        if layer_name not in layer_by_name:
            print(f"\n  ⚠️ 跳过 {layer_name}（未找到对应图层）")
            continue

        missing_pixels = int(missing.sum())

        # 跳过缺失面积太小的图层
        if missing_pixels < MIN_MISSING_AREA:
            print(f"\n  ⏭️  跳过 {layer_name}（缺失面积 {missing_pixels} < {MIN_MISSING_AREA} 像素）")
            results[layer_name] = {'success': True, 'skipped': True, 'reason': '缺失面积太小'}
            continue

        # hybrid 模式：按面积选择后端
        if backend == 'hybrid':
            if missing_pixels >= hybrid_threshold:
                layer_backend = 'sd'
                reason = f'面积 {missing_pixels} ≥ {hybrid_threshold}，用 SD'
            else:
                layer_backend = 'local'
                reason = f'面积 {missing_pixels} < {hybrid_threshold}，用 OpenCV'
            print(f"\n  🔀 {layer_name}: {reason}")
        else:
            layer_backend = backend

        # 修补（用 seg_input_path：see-through 格式下是 src_img.png，保证和图层对齐）
        # output 子目录按实际 backend 命名
        subdir = {'local': 'local', 'sd': 'sd'}.get(layer_backend, 'local')
        result = inpaint_layer(
            image_path=seg_input_path,
            missing_mask=missing,
            layer_name=layer_name,
            output_dir=os.path.join(output_dir, subdir),
            style='anime',
            backend=layer_backend,
            autodl_endpoint=autodl_endpoint,
        )
        results[layer_name] = result

        # 提取
        if result.get('success') and not result.get('skipped'):
            extract_path = os.path.join(output_dir, f'final_{layer_name}.png')
            extract_layer_from_result(
                result_path=result['result_path'],
                layer_mask=layer_by_name[layer_name]['mask'],
                output_path=extract_path,
            )

    # 汇总
    elapsed = time.time() - start_time
    subdir_label = {'local': 'local/  (OpenCV 修补结果)',
                    'sd': 'sd/  (SD Inpainting 修补结果)',
                    'hybrid': 'local/ + sd/  (混合修补结果)'}.get(backend, f'{subdir}/')
    print(f"\n{'='*60}")
    print(f"A+B 修补流程完成！耗时 {elapsed:.1f}s")
    print(f"{'='*60}")
    print(f"输出目录: {output_dir}")
    print(f"  - missing_mask.png       (缺失区域总览)")
    print(f"  - {subdir_label}")
    print(f"  - final_*.png            (提取后的最终图层)")
    n_skip = sum(1 for r in results.values() if r.get('skipped'))
    n_ok = sum(1 for r in results.values() if r.get('success') and not r.get('skipped'))
    n_err = sum(1 for r in results.values() if not r.get('success'))
    print(f"\n图层修补统计: 成功 {n_ok}，跳过 {n_skip}，失败 {n_err}")

    return {
        'success': True,
        'output_dir': output_dir,
        'results': results,
        'elapsed': elapsed,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='A+B 修补流程（海外版：Rembg + OpenCV/SD）')
    parser.add_argument('--task_dir', type=str, required=True,
                        help='任务目录路径')
    parser.add_argument('--skip_inpaint', action='store_true',
                        help='只计算缺失区域，不执行修补（用于预览）')
    parser.add_argument('--backend', type=str, default='local',
                        choices=['local', 'sd', 'hybrid'],
                        help='inpainting 后端：local=OpenCV本地(快) / sd=SD Inpainting(质量好) / hybrid=混合(按面积自动选)')
    parser.add_argument('--endpoint', '--autodl-endpoint', '--autodl_endpoint', type=str, default=None,
                        dest='autodl_endpoint',
                        help='SD Inpainting 地址（backend=sd 或 hybrid 时必填）')
    parser.add_argument('--hybrid-threshold', type=int, default=500,
                        dest='hybrid_threshold',
                        help='hybrid 模式面积阈值（像素），≥此值用 SD，< 用 OpenCV（默认 500）')
    args = parser.parse_args()

    run_pipeline(args.task_dir, args.skip_inpaint, args.backend, args.autodl_endpoint, args.hybrid_threshold)
