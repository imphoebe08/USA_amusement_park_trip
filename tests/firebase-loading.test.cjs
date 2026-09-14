const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

function setup(read) {
  const source = fs.readFileSync('src/App.tsx', 'utf8')
  const start = source.indexOf('let hasLoadedTripData = false')
  const end = source.indexOf('const emptyScheduleItem', start)
  assert.ok(end > start)
  const code = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  let timeout, delay, cleared = false
  const writes = []
  const context = vm.createContext({
    db: {}, navigator: { onLine: true }, localTripData: { demo: true },
    ensureAnonymousAuth: async () => {}, getDoc: read, getDocFromServer: read, doc: () => ({}),
    normalizeTripData: value => value, removeUndefined: value => value,
    setDoc: async (_, data) => { writes.push(data) },
    setTimeout: (fn, ms) => { timeout = fn; delay = ms; return 1 },
    clearTimeout: () => { cleared = true },
  })
  vm.runInContext(code + '\nglobalThis.api = { load: getTripDataFromFirebase, save: saveTripDataToFirebase };', context)
  return { ...context.api, writes, expire: () => timeout(), get delay() { return delay }, get cleared() { return cleared } }
}

test('a successful read clears the deadline and permits saving', async () => {
  const ui = setup(async () => ({ exists: () => true, data: () => ({ trip: 'real' }) }))
  assert.deepEqual(await ui.load(), { trip: 'real' })
  assert.equal(ui.delay, 20000); assert.equal(ui.cleared, true)
  await ui.save({ trip: 'edited' }); assert.equal(ui.writes.length, 1)
})

test('a timed out read cannot enable writes even when its late response arrives', async () => {
  let resolve
  const ui = setup(() => new Promise(r => { resolve = r }))
  const pending = ui.load()
  await Promise.resolve()
  ui.expire()
  await assert.rejects(pending, /20 秒/)
  resolve({ exists: () => true, data: () => ({ trip: 'late' }) })
  await Promise.resolve()
  await assert.rejects(ui.save({ demo: true }), /尚未成功讀取/)
  assert.equal(ui.writes.length, 0); assert.equal(ui.cleared, true)
})

test('missing offline cache never initializes cloud data', async () => {
  const ui = setup(async () => ({ exists: () => false, metadata: { fromCache: true } }))
  await assert.rejects(ui.load(), /沒有已快取/)
  await assert.rejects(ui.save({ demo: true }), /尚未成功讀取/)
  assert.equal(ui.writes.length, 0)
})

test('confirmed missing server document does not write defaults during loading', async () => {
  const ui = setup(async () => ({ exists: () => false, metadata: { fromCache: false } }))
  assert.deepEqual(await ui.load(), { demo: true })
  assert.equal(ui.writes.length, 0)
})
