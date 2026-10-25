import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import * as Vue from 'vue'
import { compile } from '@vue/compiler-dom'

// Mount the production template and setup together without adding a Vue Jest transformer.
export const compileSfc = (filename: string) => {
  const path = resolve(__dirname, '../..', filename)
  const source = readFileSync(path, 'utf8')
  const template = source.match(/<template>([\s\S]*?)<\/template>/)![1]
  const script = source.match(/<script[^>]+src="([^"]+)"/)![1]
  const component = require(resolve(dirname(path), script)).default
  const render = new Function('Vue', compile(template, { mode: 'function', prefixIdentifiers: true }).code)(Vue)
  return { ...component, render }
}
