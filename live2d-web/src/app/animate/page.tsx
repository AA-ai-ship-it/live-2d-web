'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import AnimationCanvas, { EffectState } from '@/components/AnimationCanvas'
import { useAppStore } from '@/store/useAppStore'
import { toast } from '@/store/toastStore'
import { useT } from '@/i18n/useT'
import {
  MOCK_LAYERS, EFFECT_DEFS, EXPORT_FORMATS,
  EFFECT_GROUPS, DEFAULT_EFFECTS,
  EffectCategory, ExportFormat, MockLayer, PartType,
} from '@/lib/mockData'
import type { LayerInfo } from '@/lib/api'

const CATEGORY_TABS: { id: EffectCategory; labelKey: string; icon: string }[] = [
  { id: 'face',  labelKey: 'animate.tabs.face',  icon: '😊' },
  { id: 'body',  labelKey: 'animate.tabs.body',  icon: '🫁' },
  { id: 'hair',  labelKey: 'animate.tabs.hair',  icon: '💇' },
  { id: 'scene', labelKey: 'animate.tabs.scene', icon: '✨' },
]

// 效果图标 SVG
const EFFECT_ICONS: Record<string, string> = {
  eye: 'M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5zm0 12a4.5 4.5 0 110-9 4.5 4.5 0 010 9z',
  sparkle: 'M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5z',
  heart: 'M12 21s-7-4.5-9.5-9C1 9 2.5 5.5 6 5.5c2 0 3.5 1 4.5 2.5C11.5 6.5 13 5.5 15 5.5c3.5 0 5 3.5 3.5 6.5C19 16.5 12 21 12 21z',
  chat: 'M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z',
  wind: 'M9.59 4.59A2 2 0 1111 8H2m10.59 11.41A2 2 0 1014 16H2m15.73-8.27A2.5 2.5 0 1119.5 12H2',
  tilt: 'M12 2v20M2 12l10-10 10 10',
  sway: 'M3 12c0-5 4-9 9-9s9 4 9 9M21 12c0 5-4 9-9 9s-9-4-9-9',
  leaf: 'M11 20A7 7 0 019.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z',
  star: 'M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z',
  sparkles: 'M12 3L13 9L19 10L13 11L12 17L11 11L5 10L11 9zM19 17L19.5 19.5L22 20L19.5 20.5L19 23L18.5 20.5L16 20L18.5 19.5z',
}

function layerInfoToMockLayer(layer: LayerInfo): MockLayer {
  return {
    id: layer.id,
    name: layer.name,
    partType: (layer.part_type || 'other') as PartType,
    svg: layer.url || '',
    x: layer.left,
    y: layer.top,
    w: layer.width,
    h: layer.height,
    zIndex: layer.z_index || 0,
    visible: true,
  }
}

export default function AnimatePage() {
  const { t } = useT()
  const router = useRouter()

  const {
    activeEffects,
    effectIntensity,
    toggleEffect,
    setEffectIntensity,
    setActiveEffectsFromPreset,
    layers,
    groups,
    taskId,
  } = useAppStore()

  const [activeTab, setActiveTab] = useState<EffectCategory>('face')
  const [showExport, setShowExport] = useState(false)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('gif')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    try {
      if (!activeEffects || Object.keys(activeEffects).length === 0) {
        setActiveEffectsFromPreset(DEFAULT_EFFECTS)
      }
    } catch (err) {
      toast.error(t('animate.errors.initPresetFailed'))
    }
  }, [activeEffects, setActiveEffectsFromPreset, t])

  const canvasLayers: MockLayer[] = useMemo(() => {
    try {
      if (layers && layers.length > 0) {
        return layers.map(layerInfoToMockLayer)
      }
      return MOCK_LAYERS
    } catch (err) {
      toast.error(t('animate.errors.layersConvertFailed'))
      return MOCK_LAYERS
    }
  }, [layers, t])

  const effectStates: EffectState[] = useMemo(
    () => EFFECT_DEFS.map(def => ({
      id: def.id,
      enabled: !!activeEffects[def.id],
      intensity: effectIntensity[def.id] != null
        ? effectIntensity[def.id] / 100
        : def.defaultIntensity,
    })),
    [activeEffects, effectIntensity]
  )

  const tabEffects = useMemo(
    () => EFFECT_GROUPS[activeTab] || [],
    [activeTab]
  )

  const handleToggleEffect = (id: string) => {
    try {
      toggleEffect(id)
    } catch (err) {
      toast.error(t('animate.errors.toggleFailed'))
    }
  }

  const handleSetIntensity = (id: string, value: number) => {
    try {
      setEffectIntensity(id, value)
    } catch (err) {
      toast.error(t('animate.errors.intensityFailed'))
    }
  }

  const handleExport = () => {
    try {
      setExporting(true)
      setTimeout(() => {
        try {
          setExporting(false)
          setShowExport(false)
          toast.info('Export coming soon')
        } catch (innerErr) {
          setExporting(false)
          toast.error(t('animate.errors.exportFailed'))
        }
      }, 1500)
    } catch (err) {
      setExporting(false)
      toast.error(t('animate.errors.exportFailed'))
    }
  }

  const handleExportClick = () => {
    try {
      setShowExport(true)
    } catch (err) {
      toast.error(t('animate.errors.exportDialogFailed'))
    }
  }

  const handleBack = () => {
    try {
      router.push('/')
    } catch (err) {
      toast.error(t('animate.errors.backFailed'))
    }
  }

  const activeCount = effectStates.filter(e => e.enabled).length

  return (
    <div className="animate-page">
      {/* ====== 顶栏 ====== */}
      <div className="animate-topbar">
        <button className="back-btn" onClick={handleBack}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="animate-title">
          <span className="title-text">{t('animate.title')}</span>
          <span className="title-badge">{activeCount} {t('animate.activeCount')}</span>
        </div>
        <button className="export-trigger" onClick={handleExportClick}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
          </svg>
          <span>{t('animate.exportBtn')}</span>
        </button>
      </div>

      {/* ====== Canvas 预览区 ====== */}
      <motion.div
        className="canvas-area"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <AnimationCanvas
          layers={canvasLayers}
          effects={effectStates}
          effectDefs={EFFECT_DEFS}
          width={512}
          height={512}
        />
        <div className="canvas-hint">{t('animate.previewHint')}</div>
      </motion.div>

      {/* ====== 效果控制区 ====== */}
      <div className="effect-panel">
        {/* Tab 栏 */}
        <div className="effect-tabs">
          {CATEGORY_TABS.map(tab => (
            <button
              key={tab.id}
              className={`effect-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="tab-icon">{tab.icon}</span>
              <span className="tab-label">{t(tab.labelKey)}</span>
            </button>
          ))}
        </div>

        {/* 效果卡片列表 */}
        <div className="effect-cards">
          <AnimatePresence mode="popLayout">
            {tabEffects.map((def, idx) => {
              const state = effectStates.find(s => s.id === def.id)!
              return (
                <motion.div
                  key={def.id}
                  className={`effect-card ${state.enabled ? 'on' : ''}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: idx * 0.04 }}
                  layout
                >
                  <div className="effect-card-left">
                    <div className="effect-icon-wrap">
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d={EFFECT_ICONS[def.icon] || EFFECT_ICONS.sparkle} />
                      </svg>
                    </div>
                    <div className="effect-info">
                      <span className="effect-name">{t(def.nameKey)}</span>
                      <span className="effect-desc">{t(def.descKey)}</span>
                    </div>
                  </div>
                  <div className="effect-card-right">
                    <div
                      className={`switch ${state.enabled ? 'on' : ''}`}
                      onClick={() => handleToggleEffect(def.id)}
                    >
                      <div className="switch-dot" />
                    </div>
                  </div>
                  {/* 强度滑块 */}
                  <AnimatePresence>
                    {state.enabled && (
                      <motion.div
                        className="intensity-row"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                      >
                        <span className="intensity-label">{t('animate.intensity')}</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={effectIntensity[def.id] != null ? effectIntensity[def.id] : Math.round(def.defaultIntensity * 100)}
                          onChange={e => handleSetIntensity(def.id, Number(e.target.value))}
                          className="intensity-slider"
                        />
                        <span className="intensity-value">{effectIntensity[def.id] != null ? effectIntensity[def.id] : Math.round(def.defaultIntensity * 100)}%</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* ====== 导出弹窗 ====== */}
      <AnimatePresence>
        {showExport && (
          <motion.div
            className="export-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="export-modal"
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            >
              <h3 className="export-title">{t('animate.export.title')}</h3>
              <p className="export-desc">{t('animate.export.desc')}</p>
              <div className="export-formats">
                {EXPORT_FORMATS.map(fmt => (
                  <button
                    key={fmt.id}
                    className={`export-format-btn ${exportFormat === fmt.id ? 'active' : ''}`}
                    onClick={() => setExportFormat(fmt.id)}
                  >
                    <span className="fmt-icon">{fmt.icon}</span>
                    <span className="fmt-label">{t(fmt.nameKey)}</span>
                  </button>
                ))}
              </div>
              <div className="export-actions">
                <button
                  className="export-cancel"
                  onClick={() => setShowExport(false)}
                  disabled={exporting}
                >
                  {t('animate.export.cancel')}
                </button>
                <button
                  className="export-confirm"
                  onClick={handleExport}
                  disabled={exporting}
                >
                  {exporting ? t('animate.export.processing') : t('animate.export.confirm')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
