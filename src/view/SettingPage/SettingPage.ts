import { computed, defineComponent } from 'vue'

import ModalComponent from '~/components/modal/modal.vue'
import { viewService } from '~/service/view'
import AiSettings from './subpage/aiSetting/aiSetting.vue'

export default defineComponent({
  name: 'SettingPage',
  components: { ModalComponent, AiSettings },
  setup: () => ({
    visible: computed(() => viewService.state.setting),
    handleCloseSetting: viewService.closeSettings,
  }),
})
