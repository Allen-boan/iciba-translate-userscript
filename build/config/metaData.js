// ==UserScript==
// @name               wooooowu
// @namespace          https://github.com/Allen-boan/iciba-translate-userscript/wooooowu
// @author             noe132
// @match              http://*/*
// @match              https://*/*
// @match              file:///*
// @exclude            http://www.iciba.com*
// @grant              GM_xmlhttpRequest
// @grant              GM_getValue
// @grant              GM_setValue
// @grant              GM_registerMenuCommand
// @grant              GM.xmlHttpRequest
// @grant              GM.getValue
// @grant              GM.setValue
// @grant              unsafeWindow
// @connect            api.openai.com
// @connect            api.deepseek.com
// @connect            *
// @license            MIT
// @version            {{ version }}
// @supportURL         https://github.com/Allen-boan/iciba-translate-userscript
// @description        极简 AI 划词词典，支持基础翻译、按需深入解析和英语美式/英式发音。基于 noe132 的 iciba 划词翻译项目。
// ==/UserScript==

/*
 * Original project: https://github.com/Firefox-Pro-Coding/iciba-translate-userscript
 *
 * MIT License
 *
 * Copyright (c) 2017 noe132
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// this file was compiled by webpack.

// corejs@3 polyfill bug in tampermonkey env
if (!window.Symbol) {
  window.Symbol = unsafeWindow.Symbol
}
