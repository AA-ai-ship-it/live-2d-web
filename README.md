# Live2D AI Layer Splitter

AI-powered anime character layer splitting for Live2D rigging. Upload an anime character image, the AI splits it into transparent PNG layers (hair, face, clothing, limbs, etc.) ready for Live2D rigging.

## Features

- **AI Layer Splitting** — Powered by [see-through-main](https://github.com/lllyasviel/see-through-main), 47 semantic body parts
- **NSFW Detection** — AWS Rekognition moderation (required for Stripe compliance)
- **Layer Inpainting** — Rembg foreground segmentation + OpenCV/SD inpainting to fix missing regions
- **Left/Right Split** — Symmetric parts split into left/right layers
- **PSD Export** — Download as layered PSD or individual PNGs

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 + TypeScript + Vercel |
| Backend | FastAPI + see-through-main + RunPod GPU |
| NSFW Detection | AWS Rekognition |
| File Storage | Local (Cloudflare R2 planned) |
| Payments | Stripe (planned) |

## Project Structure

```
.
├── backend/              # FastAPI 后端（部署到 RunPod）
│   ├── main.py           # 主服务：图片分割 + NSFW 检测 + 任务管理
│   ├── requirements.txt  # Python 依赖
│   └── .env.example      # 环境变量模板
│
├── live2d-web/           # Next.js 前端（部署到 Vercel）
│   ├── src/app/          # 页面（上传页 + 结果页）
│   ├── src/lib/api.ts    # API 封装
│   └── .env.local.example
│
└── api-test/             # 补图脚本（部署到 RunPod）
    ├── inpaint_pipeline.py       # A+B 修补主流程
    ├── rembg_segmentation.py     # Rembg 前景分割（替代百度 AI）
    ├── local_inpainting.py       # OpenCV inpainting
    └── backend/services/image_utils.py  # 图像工具
```

## Quick Start

### Backend (RunPod)

```bash
cd backend
cp .env.example .env  # 填入配置
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 6006
```

### Frontend (Vercel / Local)

```bash
cd live2d-web
cp .env.local.example .env.local  # 填入后端地址
npm install
npm run dev
```

### Inpainting (RunPod)

```bash
cd api-test
pip install -r requirements.txt
# 预览缺失区域
python inpaint_pipeline.py --task_dir <task_dir> --skip_inpaint
# OpenCV 修补
python inpaint_pipeline.py --task_dir <task_dir>
# SD Inpainting（需部署 endpoint）
python inpaint_pipeline.py --task_dir <task_dir> --backend sd --endpoint https://xxx/api/inpaint
```

## Environment Variables

See [backend/.env.example](backend/.env.example) and [live2d-web/.env.local.example](live2d-web/.env.local.example).

## License

MIT
