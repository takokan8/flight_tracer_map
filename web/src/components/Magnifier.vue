<template>
  <div ref="bufferARef" class="magnifier-content" :class="{ active: activeBuffer === 'a' }" :style="contentStyle"></div>
  <div ref="bufferBRef" class="magnifier-content" :class="{ active: activeBuffer === 'b' }" :style="contentStyle"></div>
  <div
    ref="lensRef"
    class="magnifier-lens"
    :class="{ dragging: isDragging }"
    :style="lensStyle"
    @pointerdown="onPointerDown"
  ></div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  diameter: { type: Number, default: 250 },
  targetSelector: { type: String, default: '#magnify-target' },
  minVisibleFraction: { type: Number, default: 0.2 },
  initialVisibleFraction: { type: Number, default: 0.92 },
  refreshInterval: { type: Number, default: 350 },
  // レンズ内の拡大率
  zoomFactor: { type: Number, default: 2.5 }
})

const lensRef = ref(null)
const bufferARef = ref(null)
const bufferBRef = ref(null)
const activeBuffer = ref('a')
const isDragging = ref(false)

const centerX = ref(0)
const centerY = ref(0)
let dragOffsetX = 0
let dragOffsetY = 0
let refreshTimer = null

const radius = computed(() => props.diameter / 2)

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

// 中心が画面の矩形からどれだけ離れられるか（px）。
// 「円の直径のminVisibleFraction割合だけ常に画面内に残す」を満たす最大距離
function overflowAllowance() {
  return radius.value * (1 - 2 * props.minVisibleFraction)
}

// 円と画面矩形の位置関係を「中心から画面矩形上の最も近い点までのユークリッド距離」で
// 判定する。X軸・Y軸を別々にクランプすると、角にドラッグしたときだけ実際の重なりが
// 極端に小さくなってしまう（円は四角ではないため）。距離ベースにすることで、
// 辺でも角でも常に同じだけの「めり込み量」が保たれる
function clampPosition(x, y) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const maxDist = overflowAllowance()

  const nearestX = clamp(x, 0, vw)
  const nearestY = clamp(y, 0, vh)
  const dx = x - nearestX
  const dy = y - nearestY
  const dist = Math.sqrt(dx * dx + dy * dy)

  if (dist <= maxDist) {
    return { x, y }
  }

  const scale = maxDist / dist
  return {
    x: nearestX + dx * scale,
    y: nearestY + dy * scale
  }
}

// デフォルト位置: 画面右下。右端はminVisibleFractionが許す限界まではみ出させ、
// 下端はレンズの下限を画面下端にぴったり合わせる
function setDefaultPosition() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  // 可視割合fのとき、右端から中心までの距離は radius * (2f - 1) になる
  // (f=0.5で中心が右端、f=1で完全に画面内、f=0で完全に画面外という直線関係)
  centerX.value = vw - radius.value * (2 * props.initialVisibleFraction - 1)
  // レンズの下端(centerY + radius)が画面下端(vh)に一致する位置
  centerY.value = vh - radius.value
}

const lensStyle = computed(() => ({
  width: `${props.diameter}px`,
  height: `${props.diameter}px`,
  transform: `translate3d(${centerX.value - radius.value}px, ${centerY.value - radius.value}px, 0)`
}))

// レンズ内の複製コンテンツは常にビューポート全体サイズで固定表示し、
// transform-originをレンズの中心座標に合わせて2倍拡大することで、
// 「レンズの中心にある地点を軸に2倍に見える」状態を作る
const contentStyle = computed(() => ({
  transform: `scale(${props.zoomFactor})`,
  transformOrigin: `${centerX.value}px ${centerY.value}px`,
  clipPath: `circle(${radius.value / props.zoomFactor}px at ${centerX.value}px ${centerY.value}px)`
}))

function onPointerDown(e) {
  isDragging.value = true
  const rect = lensRef.value.getBoundingClientRect()
  dragOffsetX = e.clientX - (rect.left + rect.width / 2)
  dragOffsetY = e.clientY - (rect.top + rect.height / 2)
  lensRef.value.setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(e) {
  if (!isDragging.value) return
  const rawX = e.clientX - dragOffsetX
  const rawY = e.clientY - dragOffsetY
  const { x, y } = clampPosition(rawX, rawY)
  centerX.value = x
  centerY.value = y
}

function onPointerUp() {
  isDragging.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
}

function handleResize() {
  const { x, y } = clampPosition(centerX.value, centerY.value)
  centerX.value = x
  centerY.value = y
}

// #magnify-target の中には（各種UIパネルなど）position:fixedの要素が
// 複数ある。祖先(.magnifier-content)にtransformをかけると、CSSの仕様上それらの
// position:fixedな子孫は「画面全体」ではなく祖先要素を基準に位置決めされるように
// 変わってしまい、拡大結果が壊れて見える。
// そのため、複製した側だけposition:fixedをabsoluteに変換し、元の要素の実座標
// （getBoundingClientRectで取得した画面上の実ピクセル位置）をそのまま固定値として
// 焼き込むことで、他のコンテンツと同じ座標系のまま一緒に拡大されるようにする
function neutralizeFixedDescendants(originalRoot, clonedRoot) {
  const originalEls = originalRoot.querySelectorAll('*')
  const clonedEls = clonedRoot.querySelectorAll('*')

  originalEls.forEach((origEl, i) => {
    const clonedEl = clonedEls[i]
    if (!clonedEl) return
    const computed = window.getComputedStyle(origEl)
    if (computed.position !== 'fixed') return

    const rect = origEl.getBoundingClientRect()
    clonedEl.style.position = 'absolute'
    clonedEl.style.left = `${rect.left}px`
    clonedEl.style.top = `${rect.top}px`
    clonedEl.style.right = 'auto'
    clonedEl.style.bottom = 'auto'
    clonedEl.style.width = `${rect.width}px`
    clonedEl.style.height = `${rect.height}px`
    clonedEl.style.margin = '0'
  })
}

function syncFormState(originalRoot, clonedRoot) {
  const originalEls = originalRoot.querySelectorAll('select, input, textarea')
  const clonedEls = clonedRoot.querySelectorAll('select, input, textarea')

  originalEls.forEach((origEl, i) => {
    const clonedEl = clonedEls[i]
    if (!clonedEl) return
    if (origEl.tagName === 'SELECT') {
      clonedEl.selectedIndex = origEl.selectedIndex
    } else {
      clonedEl.value = origEl.value
      if (origEl.type === 'checkbox' || origEl.type === 'radio') {
        clonedEl.checked = origEl.checked
      }
    }
  })
}

function waitForTileImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'))
  const pending = imgs.filter((img) => !img.complete)
  if (pending.length === 0) return Promise.resolve()

  return Promise.race([
    Promise.all(
      pending.map(
        (img) =>
          new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true })
            img.addEventListener('error', resolve, { once: true })
          })
      )
    ),
    // 一部タイルがいつまでも読み込めない場合に備えたタイムアウト
    new Promise((resolve) => setTimeout(resolve, 300))
  ])
}

let isRefreshing = false

async function refreshClone() {
  if (isRefreshing) return // 前回の待機がまだ終わっていなければ今回はスキップ
  isRefreshing = true

  try {
    const target = document.querySelector(props.targetSelector)
    const inactiveEl = activeBuffer.value === 'a' ? bufferBRef.value : bufferARef.value
    if (!target || !inactiveEl) return

    const clone = target.cloneNode(true)
    neutralizeFixedDescendants(target, clone)
    syncFormState(target, clone)

    const originalCanvases = target.querySelectorAll('canvas')
    const clonedCanvases = clone.querySelectorAll('canvas')
    originalCanvases.forEach((origCanvas, i) => {
      const clonedCanvas = clonedCanvases[i]
      if (!clonedCanvas) return
      clonedCanvas.width = origCanvas.width
      clonedCanvas.height = origCanvas.height
      const ctx = clonedCanvas.getContext('2d')
      if (ctx) ctx.drawImage(origCanvas, 0, 0)
    })

    await waitForTileImages(clone)

    inactiveEl.innerHTML = ''
    inactiveEl.appendChild(clone)

    activeBuffer.value = activeBuffer.value === 'a' ? 'b' : 'a'
  } finally {
    isRefreshing = false
  }
}

onMounted(() => {
  setDefaultPosition()
  refreshClone()
  refreshTimer = window.setInterval(refreshClone, props.refreshInterval)
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
})
</script>

<style scoped>
.magnifier-lens {
  position: fixed;
  left: 0;
  top: 0;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.5);
  box-shadow:
    0 0 0 0.4px rgba(50, 50, 50, 0.75),
    0 4px 10px rgba(50, 50, 50, 0.65);
  cursor: grab;
  z-index: 1000000;
  touch-action: none;
  background: transparent;
  pointer-events: auto;
  will-change: transform;
}

.magnifier-lens.dragging {
  cursor: grabbing;
}

.magnifier-content {
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  will-change: transform;
  opacity: 0;
  z-index: 999999;
}
.magnifier-content.active {
  opacity: 1;
}
</style>
