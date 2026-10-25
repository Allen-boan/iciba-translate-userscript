module.exports = (api) => {
  api.cache.using(() => process.env.NODE_ENV)

  return {
    'presets': [
      ['@babel/preset-env', {
        modules: false,
        bugfixes: true,
      }],
    ],
    'plugins': [
      ['@babel/transform-runtime', {
        useESModules: true,
      }],

      ['polyfill-corejs3', {
        'method': 'usage-pure',
      }],
    ],
  }
}
