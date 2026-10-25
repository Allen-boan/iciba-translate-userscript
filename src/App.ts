// eslint-disable-next-line import/no-unassigned-import
import '~/util/trustedHTMLHack'
import { defineComponent, onMounted } from 'vue'

import AiPopup from '~/view/AiPopup/AiPopup.vue'
import SettingPage from '~/view/SettingPage/SettingPage.vue'
import { viewService } from './service/view'
import { registerMenuCommand } from './util/gmapi'

export default defineComponent({
  name: 'IcibaAppRoot',
  components: {
    AiPopup,
    SettingPage,
  },
  setup: () => {
    onMounted(() => {
      registerMenuCommand('打开 AI 词典设置', () => {
        viewService.openSettings()
      })
    })
    return {}
  },
})
