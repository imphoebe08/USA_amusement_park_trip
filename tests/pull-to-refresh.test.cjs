const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

function setup({ mobile = true, scroll = 0, nested = false } = {}) {
  const listeners = new Map()
  class Element {
    closest() { return null }
  }
  const body = new Element(); body.dataset = {}
  const target = new Element(); target.parentElement = body
  const document = { body, documentElement: {},
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  }
  let refreshed = 0, progress = 0
  const context = { exports: {}, document, window: { scrollY: scroll }, Element,
    matchMedia: () => ({ matches: mobile }),
    getComputedStyle: () => ({ overflowX: nested ? 'auto' : 'visible', overflowY: 'visible' }),
  }
  const code = ts.transpileModule(fs.readFileSync('src/pullToRefreshGesture.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, context)
  const cleanup = context.exports.installPullToRefresh({ onProgress: value => { progress = value }, onRefresh: () => { refreshed++ } })
  const emit = (name, x = 0, y = 0, count = 1) => {
    let prevented = false
    listeners.get(name)({ type: name, target, touches: Array.from({ length: count }, (_, identifier) => ({ identifier, clientX: x, clientY: y })), cancelable: true, preventDefault() { prevented = true } })
    return prevented
  }
  return { emit, body, cleanup, get refreshed() { return refreshed }, get progress() { return progress } }
}

test('pulling at the top refreshes once on release, not during movement', () => {
  const ui = setup()
  ui.emit('touchstart'); assert.equal(ui.emit('touchmove', 0, 150), true)
  assert.ok(ui.progress >= 72); assert.equal(ui.refreshed, 0)
  ui.emit('touchend'); ui.emit('touchend'); assert.equal(ui.refreshed, 1)
  ui.cleanup()
})

for (const [label, options] of [['desktop', { mobile: false }], ['scrolled page', { scroll: 100 }], ['nested scroll area', { nested: true }]]) {
  test(`${label} does not intercept scrolling or refresh`, () => {
    const ui = setup(options)
    ui.emit('touchstart'); assert.equal(ui.emit('touchmove', 0, 150), false)
    ui.emit('touchend'); assert.equal(ui.refreshed, 0); ui.cleanup()
  })
}

for (const scenario of ['short', 'horizontal', 'cancel', 'drag', 'multitouch', 'pull back']) {
  test(`${scenario} gesture does not refresh`, () => {
    const ui = setup()
    ui.emit('touchstart')
    if (scenario === 'drag') ui.body.dataset.dragOwner = 'card'
    ui.emit('touchmove', scenario === 'horizontal' ? 200 : 0, scenario === 'short' ? 40 : 150, scenario === 'multitouch' ? 2 : 1)
    if (scenario === 'pull back') ui.emit('touchmove', 0, 10)
    ui.emit(scenario === 'cancel' ? 'touchcancel' : 'touchend')
    assert.equal(ui.refreshed, 0); assert.equal(ui.progress, 0); ui.cleanup()
  })
}
