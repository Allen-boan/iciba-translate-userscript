export const registerMenuCommand = (name: string, fn: () => unknown) => {
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand(name, fn)
  }
}
