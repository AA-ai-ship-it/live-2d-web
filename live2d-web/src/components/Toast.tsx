'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useToastStore, type ToastItem } from '@/store/toastStore'

const TOAST_COLORS: Record<ToastItem['type'], string> = {
  success: 'linear-gradient(135deg, rgba(52, 211, 153, 0.18), rgba(52, 211, 153, 0.08))',
  error: 'linear-gradient(135deg, rgba(248, 113, 113, 0.2), rgba(248, 113, 113, 0.08))',
  warn: 'linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(251, 191, 36, 0.08))',
  info: 'linear-gradient(135deg, rgba(124, 92, 255, 0.22), rgba(34, 211, 238, 0.12))',
}

const TOAST_ICON: Record<ToastItem['type'], string> = {
  success: '✅',
  error: '✕',
  warn: '⚠',
  info: 'ℹ',
}

const TOAST_BORDER: Record<ToastItem['type'], string> = {
  success: 'rgba(52, 211, 153, 0.4)',
  error: 'rgba(248, 113, 113, 0.4)',
  warn: 'rgba(251, 191, 36, 0.4)',
  info: 'rgba(124, 92, 255, 0.45)',
}

export default function ToastContainer() {
  const items = useToastStore((s) => s.items)
  const dismiss = useToastStore((s) => s.dismiss)

  return (
    <div className="toast-root" aria-live="polite">
      <AnimatePresence>
        {items.map((it) => (
          <motion.div
            key={it.id}
            className="toast-item"
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            style={{
              background: TOAST_COLORS[it.type],
              borderColor: TOAST_BORDER[it.type],
            }}
            onClick={() => dismiss(it.id)}
          >
            <span className="toast-icon">{TOAST_ICON[it.type]}</span>
            <span className="toast-msg">{it.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
