import { reactive } from 'vue'

const state = reactive({ setting: false })

export const viewService = {
  state,
  openSettings: () => { state.setting = true },
  closeSettings: () => { state.setting = false },
}
