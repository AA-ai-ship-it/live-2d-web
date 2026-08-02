# AI API 测试工具

用于测试国内 AI 图像分割 API 服务商，替代透视项目（see-through）的自建 GPU 方案。

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 配置 API Key

编辑 `config.py`，填入你的 API Key：

```python
# 阿里云
ALIYUN_CONFIG = {
    'access_key_id': '你的AccessKey ID',
    'access_key_secret': '你的AccessKey Secret',
}

# 火山引擎
VOLCENGINE_CONFIG = {
    'access_key': '你的Access Key',
    'secret_key': '你的Secret Key',
}
```

### 3. 准备测试图片

将一张立绘图片放在 `test_images/` 目录下，命名为 `sample.png`（或修改 config.py 中的路径）。

### 4. 运行测试

```bash
python test_main.py
```

## 测试内容

| 测试项 | 文件 | 说明 |
|--------|------|------|
| 阿里云人像分割 | `aliyun_segmentation.py` | 人像抠图 API |
| 火山引擎人像抠图 | `volcengine_segmentation.py` | 人像抠图 API |
| 规则引擎 | `rule_engine.py` | 深度/层级估计 |
| 主入口 | `test_main.py` | 统一测试入口 |

## 服务商对比

| 服务商 | 价格 | 优势 |
|--------|------|------|
| 阿里云 | 0.05元/次 | 稳定、有免费额度 |
| 火山引擎 | 0.015元/次 | 最便宜 |

## 下一步

测试通过后，将选择效果最好的服务商，组合成完整的 AI 分割流水线，替代 see-through 项目。
