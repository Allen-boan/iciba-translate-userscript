<template>
  <button
    v-if="trigger.visible"
    type="button"
    class="ai-selection-trigger"
    :style="triggerStyle"
    title="点击翻译选中文本"
    aria-label="翻译选中文本"
    @mousedown.prevent.stop
    @click.stop="m.activateSelection"
    @keydown.stop
    @keyup.stop
  >
    <span aria-hidden="true">译</span>
  </button>
  <section
    v-if="state.visible"
    ref="popup"
    class="ai-popup"
    :class="{ 'is-dragging': dragging }"
    :style="style"
    role="dialog"
    aria-label="AI 划词词典"
    @keydown.stop
    @keyup.stop
  >
    <header class="toolbar" @mousedown="m.startDrag">
      <span>AI 词典</span>
      <div class="tools">
        <button type="button" @mousedown.prevent @click="m.openSettings">AI 设置</button>
        <button type="button" aria-label="关闭翻译窗口" @mousedown.prevent @click="m.close">关闭</button>
      </div>
    </header>
    <div class="popup-body" role="region" aria-label="翻译和解析内容" tabindex="0">
      <p class="original">{{ state.text }}</p>
      <div class="pronunciation" aria-label="英语发音">
        <button
          type="button"
          :disabled="!speech.usAvailable"
          :title="speech.usAvailable ? '朗读英语原文（美式）' : '浏览器未提供 en-US 语音'"
          :aria-pressed="speech.speakingAccent === 'en-US'"
          @mousedown.prevent
          @click="m.speak('en-US')"
        >
          {{ speech.usAvailable ? '美式发音' : '美式发音（不可用）' }}
        </button>
        <button
          type="button"
          :disabled="!speech.gbAvailable"
          :title="speech.gbAvailable ? '朗读英语原文（英式）' : '浏览器未提供 en-GB 语音'"
          :aria-pressed="speech.speakingAccent === 'en-GB'"
          @mousedown.prevent
          @click="m.speak('en-GB')"
        >
          {{ speech.gbAvailable ? '英式发音' : '英式发音（不可用）' }}
        </button>
      </div>
      <p v-if="!speech.supported" class="notice">当前浏览器不支持原生语音朗读。</p>
      <p v-if="speech.errorMessage" class="error" role="status">{{ speech.errorMessage }}</p>
      <div class="translation" aria-live="polite" aria-atomic="true">
        <p v-if="busy" role="status">{{ translation.status === 'debouncing' ? '准备翻译…' : '正在翻译…' }}</p>
        <p v-else-if="translation.status === 'error'" class="error">{{ translation.errorMessage }}</p>
        <p v-else-if="translation.status === 'cancelled'" class="notice">翻译已取消。</p>
        <p v-else-if="translation.result" class="result">{{ translation.result }}</p>
      </div>
      <section v-if="canAnalyze" class="analysis" aria-label="深入解析">
        <div class="analysis-actions">
          <button
            type="button"
            :disabled="analysis.status === 'loading'"
            :aria-expanded="analysis.expanded"
            aria-controls="iciba-ai-analysis"
            @mousedown.prevent
            @click="m.toggleAnalysis"
          >
            {{ analysisButtonLabel }}
          </button>
          <button
            v-if="analysis.status === 'loading'"
            type="button"
            @mousedown.prevent
            @click="m.cancelAnalysis"
          >
            取消解析
          </button>
          <span v-if="analysis.cached" class="notice">解析来自本次阅读缓存</span>
        </div>
        <div
          v-if="analysis.expanded"
          id="iciba-ai-analysis"
          class="analysis-content"
          aria-live="polite"
          :aria-busy="analysis.status === 'loading'"
        >
          <p v-if="analysis.status === 'loading'" role="status">正在生成学习解析…</p>
          <p v-else-if="analysis.status === 'error'" class="error">{{ analysis.errorMessage }}</p>
          <p v-else-if="analysis.status === 'cancelled'" class="notice">解析已取消，基础译文仍然保留。</p>
          <p v-else-if="analysis.result" class="result">{{ analysis.result }}</p>
        </div>
      </section>
      <footer>
        <span v-if="translation.cached" class="notice">来自本次阅读缓存</span>
        <button v-if="busy" type="button" @mousedown.prevent @click="m.cancel">取消翻译</button>
        <button
          v-else-if="translation.status === 'error' || translation.status === 'cancelled'"
          type="button"
          @mousedown.prevent
          @click="m.retry"
        >
          重试翻译
        </button>
      </footer>
    </div>
  </section>
</template>

<script lang="ts" src="./AiPopup.ts"></script>
<style lang="sass" src="./AiPopup.sass" scoped></style>
