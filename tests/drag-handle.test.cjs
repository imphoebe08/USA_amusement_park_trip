const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

function setup(saveResult = true) {
  const events = new Map()
  class Element {
    constructor() {
      this.style = {}
      this.dataset = {}
      this.isConnected = true
      this.classes = new Set()
      this.classList = { add: (...names) => names.forEach(n => this.classes.add(n)), remove: (...names) => names.forEach(n => this.classes.delete(n)) }
    }
    addEventListener(name, fn) { events.set(`${this.id}:${name}`, fn) }
    removeEventListener(name) { events.delete(`${this.id}:${name}`) }
    closest(selector) { return selector === '[data-drag-group]' ? this : null }
    contains(element) { return element === this }
    getBoundingClientRect() { return { left: 10, top: this === target ? 200 : 20, width: 300, height: 100 } }
    cloneNode() { const copy = new Element(); copy.removeAttribute = () => {}; copy.setAttribute = () => {}; copy.querySelectorAll = () => []; return copy }
    animate(frames) { animations.push(frames); return { finished: Promise.resolve() } }
    remove() { this.removed = true }
  }
  const card = new Element(); card.id = 'card'; card.dataset = { dragGroup: 'schedule', dragIndex: '0' }
  const target = new Element(); target.dataset = { dragGroup: 'schedule', dragIndex: '1' }
  const body = new Element(); body.append = (node) => { ghost = node }
  const button = new Element(); button.closest = () => card
  const document = new Element(); document.id = 'document'; document.body = body
  document.elementFromPoint = () => hit
  document.querySelector = () => target
  const window = new Element(); window.id = 'window'; window.setTimeout = setTimeout; window.scrollBy = () => {}
  let hit = card, ghost, cleanup
  const animations = [], starts = [], moves = []
  const context = {
    exports: {}, Element, document, window, navigator: { vibrate() {} }, innerHeight: 800,
    setTimeout, clearTimeout, requestAnimationFrame: (fn) => setTimeout(fn, 5), cancelAnimationFrame: clearTimeout,
    matchMedia: () => ({ matches: false }),
    require: (name) => name === 'react' ? {
      useRef: (value) => ({ current: value === null ? button : value }),
      useLayoutEffect: (fn) => fn(), useEffect: (fn) => { cleanup = fn() },
    } : { jsx: () => null },
  }
  const code = ts.transpileModule(fs.readFileSync('src/DragHandle.tsx', 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, context)
  context.exports.DragHandle({ group: 'schedule', index: 0, onStart: i => starts.push(i), onOver() {}, onEnd() {}, onMove: async (...args) => { moves.push(args); return saveResult } })
  const touch = (x = 20, y = 30) => ({ identifier: 1, clientX: x, clientY: y })
  return {
    card, target, body, starts, moves, animations,
    get ghost() { return ghost },
    mouseDown: (target = card, button = 0) => events.get('card:mousedown')({ target, button, clientX: 20, clientY: 30, preventDefault() {} }),
    mouseMove: (x, y) => events.get('document:mousemove')({ clientX: x, clientY: y }),
    mouseUp: () => events.get('document:mouseup')(),
    click: () => { let prevented = false; events.get('card:click')({ preventDefault() { prevented = true }, stopPropagation() {} }); return prevented },
    start: () => events.get('card:touchstart')({ target: card, touches: [touch()], changedTouches: [touch()] }),
    move: (x, y) => { let prevented = false; events.get('document:touchmove')({ touches: [touch(x, y)], cancelable: true, preventDefault() { prevented = true } }); return prevented },
    end: (cancelled = false) => events.get('document:touchend')({ type: cancelled ? 'touchcancel' : 'touchend', changedTouches: [touch()], cancelable: true, preventDefault() {} }),
    hit: (element) => { hit = element }, cleanup: () => cleanup(),
  }
}
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

test('a normal swipe scrolls without activating a drag', async () => {
  const ui = setup()
  try { ui.start(); assert.equal(ui.move(20, 60), false); await wait(410); assert.equal(ui.starts.length, 0); assert.equal(ui.ghost, undefined) }
  finally { ui.cleanup() }
})

test('long press lifts, follows the finger, highlights and snaps to the saved destination', async () => {
  const ui = setup()
  try {
    ui.start(); assert.equal(ui.starts.length, 0); await wait(410)
    assert.deepEqual(ui.starts, [0]); assert.ok(ui.card.classes.has('drag-source'))
    ui.hit(ui.target); assert.equal(ui.move(40, 230), true); await wait(20)
    assert.equal(ui.ghost.style.top, '220px'); assert.ok(ui.target.classes.has('drop-zone-active'))
    ui.end(); await wait(30)
    assert.deepEqual(ui.moves, [[1, 0]])
    assert.equal(ui.animations.at(-1)[1].top, '200px')
    assert.ok(ui.ghost.removed); assert.equal(ui.body.dataset.dragOwner, undefined)
    assert.equal(ui.target.classes.has('drag-landing-hidden'), false)
  } finally { ui.cleanup() }
})

for (const scenario of ['save failure', 'cancel', 'outside']) {
  test(`${scenario} returns to the original position`, async () => {
    const ui = setup(false)
    try {
      ui.start(); await wait(410); ui.hit(scenario === 'outside' ? null : ui.target)
      ui.move(40, 230); ui.end(scenario === 'cancel'); await wait(30)
      assert.equal(ui.animations.at(-1)[1].top, '20px')
      assert.equal(ui.moves.length, scenario === 'save failure' ? 1 : 0)
      assert.ok(ui.ghost.removed); assert.equal(ui.card.classes.has('drag-source'), false)
    } finally { ui.cleanup() }
  })
}


test('desktop mouse movement starts dragging immediately and saves on release', async () => {
  const ui = setup()
  try {
    ui.mouseDown(); assert.equal(ui.starts.length, 0)
    ui.hit(ui.target); ui.mouseMove(40, 230)
    assert.deepEqual(ui.starts, [0]); assert.ok(ui.target.classes.has('drop-zone-active'))
    ui.mouseUp(); await wait(30)
    assert.deepEqual(ui.moves, [[1, 0]]); assert.ok(ui.ghost.removed)
    assert.equal(ui.click(), true)
  } finally { ui.cleanup() }
})

test('desktop click and small movements do not reorder or swallow the click', () => {
  const ui = setup()
  try {
    ui.mouseDown(); ui.mouseMove(22, 32); ui.mouseUp()
    assert.equal(ui.starts.length, 0); assert.equal(ui.moves.length, 0)
    assert.equal(ui.click(), false)
  } finally { ui.cleanup() }
})

test('desktop dragging on a flight summary works but ordinary controls are excluded', async () => {
  const ui = setup()
  try {
    const control = Object.create(ui.card)
    control.closest = () => control
    control.hasAttribute = () => false
    ui.mouseDown(control); ui.mouseMove(40, 230)
    assert.equal(ui.starts.length, 0)
    control.hasAttribute = name => name === 'data-drag-surface'
    ui.mouseDown(control); ui.hit(ui.target); ui.mouseMove(40, 230); ui.mouseUp()
    await wait(30); assert.deepEqual(ui.moves, [[1, 0]])
  } finally { ui.cleanup() }
})
