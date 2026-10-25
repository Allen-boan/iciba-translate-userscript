<template>
  <form class="ai-settings" @submit.prevent="m.save" @keydown.stop @keyup.stop>
    <header>
      <h2>连接你的 AI</h2>
      <p class="description">选择接口、输入密钥，读取模型后选择并保存。</p>
    </header>

    <div class="field">
      <label for="iciba-ai-provider">AI 服务商</label>
      <select id="iciba-ai-provider" :value="state.provider" :disabled="disabled" @change="m.selectProvider">
        <option v-for="provider in providers" :key="provider.value" :value="provider.value">{{ provider.label }}</option>
      </select>
      <p v-if="state.provider !== 'custom'" class="hint">使用官方接口：{{ state.baseUrl }}</p>
    </div>

    <div v-if="state.provider === 'custom'" class="field">
      <label for="iciba-ai-base-url">API 接口地址</label>
      <input
        id="iciba-ai-base-url"
        type="url"
        :value="state.baseUrl"
        :disabled="disabled"
        placeholder="https://你的接口地址/v1"
        spellcheck="false"
        autocomplete="off"
        @input="m.handleInput('baseUrl', $event)"
      >
      <p class="hint">填写 HTTPS 基础地址，不含 /chat/completions 或 /models；只向此地址发送密钥。脚本管理器可能需要你授权此域名。</p>
    </div>

    <div class="field">
      <label for="iciba-ai-key">接口密钥 <span class="label-note">API Key</span></label>
      <input
        id="iciba-ai-key"
        ref="keyInput"
        type="password"
        :disabled="disabled"
        :placeholder="state.hasApiKey ? '已保存，留空继续使用' : '粘贴当前服务商的密钥'"
        spellcheck="false"
        autocomplete="new-password"
        aria-describedby="iciba-ai-key-hint"
        @input="m.handleInput('apiKey', $event)"
      >
      <p id="iciba-ai-key-hint" class="hint">密钥保存在脚本管理器中，保存后不再显示；切换接口需重新输入。</p>
    </div>

    <div class="actions">
      <button type="button" :disabled="disabled || state.modelsLoading || state.testing" @click="m.listModels">
        {{ state.modelsLoading ? '正在获取模型…' : '验证密钥并获取模型' }}
      </button>
      <button v-if="state.modelsLoading" type="button" @click="m.cancelModels">取消获取</button>
    </div>
    <p class="hint test-hint">只请求当前接口的 /models，不发送生成请求，也不逐个测试模型。</p>
    <p v-if="state.modelsMessage" :class="['status', state.modelsStatus === 'error' ? 'error' : 'info']" role="status" aria-live="polite">
      {{ state.modelsMessage }}
    </p>

    <div v-if="state.models.length" class="field">
      <label for="iciba-ai-model-search">搜索模型</label>
      <input
        id="iciba-ai-model-search"
        type="search"
        :value="state.modelSearch"
        :disabled="disabled"
        placeholder="输入模型 ID 关键词"
        autocomplete="off"
        @input="m.searchModels"
      >
    </div>
    <div class="field">
      <label for="iciba-ai-model">翻译模型</label>
      <select id="iciba-ai-model" :value="selectedModel" :disabled="disabled || state.modelsLoading" @change="m.selectModel">
        <option value="" disabled>请获取并选择模型，或手动输入模型 ID</option>
        <option v-if="unlistedModel" :value="state.model">{{ state.model }}（当前配置，能力未验证）</option>
        <option v-for="model in models" :key="model.id" :value="model.id">
          {{ model.id }}{{ model.kind === 'unknown' ? '（能力未确认）' : '（文本候选）' }}
        </option>
      </select>
      <p class="hint">仅按名称和接口元数据筛选候选项，不保证都支持 Chat Completions。已保存的模型可继续使用；查询失败可在高级设置手动输入。</p>
      <p v-if="state.models.length && !models.length" class="hint">没有匹配的模型，请更换搜索词或手动输入模型 ID。</p>
    </div>

    <div class="actions">
      <button type="submit" class="primary" :disabled="disabled || state.modelsLoading || !state.model.trim()">{{ state.saving ? '保存中…' : '保存配置' }}</button>
    </div>
    <p v-if="state.message" :class="['status', state.messageType]" role="status" aria-live="polite">{{ state.message }}</p>
    <p v-if="state.loading" class="hint" role="status">正在读取配置…</p>

    <div class="advanced">
      <button
        type="button"
        class="advanced-toggle"
        :aria-expanded="state.advancedOpen"
        aria-controls="iciba-ai-advanced"
        :disabled="disabled"
        @click="m.toggleAdvanced"
      >
        <span>{{ state.advancedOpen ? '收起高级设置' : '手动输入模型 / 高级设置' }}</span>
        <span aria-hidden="true">{{ state.advancedOpen ? '−' : '+' }}</span>
      </button>
      <div v-if="state.advancedOpen" id="iciba-ai-advanced" class="advanced-fields">
        <div class="field">
          <label for="iciba-ai-manual-model">手动输入模型 ID</label>
          <input
            id="iciba-ai-manual-model"
            type="text"
            :value="state.model"
            :disabled="disabled || state.modelsLoading"
            placeholder="填写服务商提供的完整模型 ID"
            spellcheck="false"
            autocomplete="off"
            @input="m.handleInput('model', $event)"
          >
          <p class="hint">适用于未提供 /models 或列表不完整的接口；不会自动替换成其他服务商的模型。</p>
        </div>
        <div class="actions">
          <button type="button" :disabled="disabled || state.testing || state.modelsLoading || !state.model.trim()" @click="m.testConnection">
            {{ state.testing ? '测试中…' : '测试选中模型' }}
          </button>
          <button v-if="state.testing" type="button" @click="m.cancel">取消测试</button>
        </div>
        <p class="hint">测试选中模型会发送一次简短生成请求，可能产生费用；不会自动保存，也不会测试其他模型。</p>
        <p class="hint">请在可信页面配置密钥。脚本管理器存储并非加密保险箱。</p>
      </div>
    </div>
  </form>
</template>

<script lang="ts" src="./aiSetting.ts"></script>
<style lang="sass" src="./aiSetting.sass" scoped></style>
