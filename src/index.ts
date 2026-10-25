/* eslint-disable import/no-unassigned-import, import/order */
import { shadowRoot } from './service/shadowRoot'
import { createApp, h } from 'vue'

import '~/assets/styles/tailwind.sass'

import NoOverscroll from './util/diretives/no-overscroll'

import App from '~/App.vue'

const main = () => {
  const app = createApp({
    render() {
      return h(App)
    },
  })

  app.directive('no-overscroll', NoOverscroll)

  const appRoot = document.createElement('div')
  shadowRoot.appendChild(appRoot)
  app.mount(appRoot)
}

main()
