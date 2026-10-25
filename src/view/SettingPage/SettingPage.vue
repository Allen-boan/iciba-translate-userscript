<template>
  <modal-component :open="visible" @close="handleCloseSetting">
    <div class="setting-window relative flex bg-white shadow-8 ease-in-out duration-300 overflow-hidden">
      <div class="tabs-box flex-auto overflow-auto p-4" v-no-overscroll>
        <ai-settings :open="visible" :active="visible" />
      </div>
    </div>
  </modal-component>
</template>

<script lang="ts" src="./SettingPage.ts"></script>
<style lang="sass" src="./SettingPage.sass" scoped></style>
