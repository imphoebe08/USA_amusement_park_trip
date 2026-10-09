const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const preparation = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/preparation.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, preparation)
const source = fs.readFileSync('src/App.tsx', 'utf8')
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const code = ts.transpileModule([
  extract('const saveTripDataToFirebase', 'const emptyScheduleItem'),
  extract('  const deleteScheduleItem', '  const openDataEditor'),
  extract('  const deleteDataEditor', '  const toggleVoucherUsed'),
  extract('  const saveDataEditor', '  const deleteDataEditor'),
  extract('  const handleCertificateChange', '  const saveDataEditor'),
  extract('  const toggleVoucherUsed', '  const reorderScheduleItems'),
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function setup(kind, persist = async () => {}) {
  const pair = () => [{ id: 'keep' }, { id: 'delete' }]
  const original = {
    flightInfo: pair(), bookingCards: pair(), expenseEntries: pair(), planningTasks: pair(), members: pair(),
    dayPlans: [{ date: '11/4', items: pair() }, { date: '11/5', items: pair() }],
    parkSections: [{ id: 'universal', days: [{ id: 'day1', routes: pair() }, { id: 'day2', routes: pair() }] }, { id: 'disney', days: [{ id: 'day1', routes: pair() }] }],
  }
  const writes = [], updates = [], errors = [], closed = []
  const context = vm.createContext({
    ...preparation.exports, members: [{ name: 'A' }, { name: 'B' }], preparationMode: '待辦', pendingCertificate: null, setPendingCertificate: value => { context.pendingCertificate = value }, setCertificateStatus: () => {}, setDataDraft: fn => { context.dataDraft = fn(context.dataDraft) }, tripData: original, isSaving: false, hasLoadedTripData: true,
    window: { confirm: () => true }, draftItem: { title: '行程' }, dataDraft: { title: '資料' },
    dataEditor: { kind, index: 1, parkId: 'universal', dayId: 'day1' }, editingItem: { date: '11/4', index: 1 },
    db: {}, navigator: { onLine: true }, ensureAnonymousAuth: async () => {},
    doc: (...args) => args.slice(1).join('/'), removeUndefined: value => value,
    setDoc: async (path, data) => { writes.push({ path, data }); await persist() },
    setIsSaving: value => { context.isSaving = value }, setTripData: value => updates.push(value),
    setDataEditor: value => closed.push(value), setEditingItem: value => closed.push(value),
    setExpandedFlightIndex: () => {}, setErrorMessage: value => errors.push(value), getFirebaseErrorMessage: (_, fallback) => fallback,
    console: { error() {} },
  })
  vm.runInContext(code + '\nglobalThis.toggleVoucher = toggleVoucherUsed; globalThis.toggleTask = togglePlanningTask; globalThis.save = saveDataEditor; globalThis.select = handleCertificateChange; globalThis.close = closeDataEditor; globalThis.remove = ' + (kind === 'schedule' ? 'deleteScheduleItem' : 'deleteDataEditor'), context)
  return { save: context.save, remove: context.remove, original, writes, updates, errors, closed, context }
}

const fields = { flight: 'flightInfo', booking: 'bookingCards', expense: 'expenseEntries', task: 'planningTasks', member: 'members' }
for (const kind of ['schedule', ...Object.keys(fields), 'route']) {
  test(`${kind}: writes only the selected deletion and waits for Firebase acknowledgement`, async () => {
    let acknowledge
    const ui = setup(kind, () => new Promise(resolve => { acknowledge = resolve }))
    const pending = ui.remove()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(ui.writes.length, 1); assert.equal(ui.writes[0].path, 'trip/orlando-escape')
    assert.equal(ui.updates.length, 0); assert.equal(ui.closed.length, 0)
    const expected = structuredClone(ui.original)
    if (kind === 'schedule') expected.dayPlans[0].items.pop()
    else if (kind === 'route') expected.parkSections[0].days[0].routes.pop()
    else expected[fields[kind]].pop()
    assert.deepEqual(JSON.parse(JSON.stringify(ui.writes[0].data)), expected)
    acknowledge(); await pending
    assert.equal(ui.updates.length, 1); assert.deepEqual(ui.closed, [null]); assert.equal(ui.context.isSaving, false)
  })
  test(`${kind}: rejected write keeps the original data and editor`, async () => {
    const ui = setup(kind, async () => { throw new Error('permission-denied') })
    await ui.remove()
    assert.equal(ui.updates.length, 0); assert.equal(ui.closed.length, 0)
    assert.equal(ui.errors.length, 1); assert.equal(ui.context.isSaving, false)
  })
}
for (const kind of ['tripSettings', 'parkDay']) {
  test(`${kind}: does not issue a misleading no-op delete`, async () => {
    const ui = setup(kind); await ui.remove(); assert.equal(ui.writes.length, 0)
  })
}
test('deleting the last flight persists an empty array', async () => {
  const ui = setup('flight'); ui.original.flightInfo = [{ id: 'only' }]; ui.context.dataEditor.index = 0
  await ui.remove(); assert.equal(ui.writes[0].data.flightInfo.length, 0)
})
test('duplicate deletion while saving is ignored', async () => {
  const ui = setup('booking'); ui.context.isSaving = true
  await ui.remove(); assert.equal(ui.writes.length, 0)
})


test('flight notes are written, can be cleared, and remain in the draft on rejection', async () => {
  for (const note of ['轉機請預留時間\n行李直掛', '']) {
    const ui = setup('flight')
    ui.context.dataDraft = { title: 'UA838', flightNumber: 'UA838', note }
    await ui.save()
    assert.equal(ui.writes[0].data.flightInfo[1].note, note)
    assert.equal(ui.writes[0].data.flightInfo[0].id, 'keep')
  }
  const ui = setup('flight', async () => { throw new Error('permission-denied') })
  ui.context.dataDraft = { title: 'UA838', note: '保留這份備註' }
  await ui.save()
  assert.equal(ui.closed.length, 0)
  assert.equal(ui.context.dataDraft.note, '保留這份備註')
})

test('airport labels normalize codes and do not invent an unknown destination', () => {
  const context = { exports: {} }
  const airportCode = ts.transpileModule(fs.readFileSync('src/airports.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(airportCode, context)
  const label = context.exports.getAirportPlace
  assert.equal(label(' khh '), '高雄')
  assert.equal(label('NRT'), '東京（成田）')
  assert.equal(label('LAX'), '洛杉磯')
  assert.equal(label('MCO'), '奧蘭多')
  assert.equal(label('PUS'), '釜山')
  assert.equal(label('XYZ'), 'XYZ')
  assert.equal(label(''), '未設定機場')
})

for (const kind of ['schedule', ...Object.keys(fields), 'route']) {
  test(`${kind}: cancelling confirmation does not write or close the editor`, async () => {
    const ui = setup(kind)
    ui.context.window.confirm = () => false
    await ui.remove()
    assert.equal(ui.writes.length, 0)
    assert.equal(ui.updates.length, 0)
    assert.equal(ui.closed.length, 0)
    assert.equal(ui.context.isSaving, false)
  })
}

test('selecting a certificate only stages the file, and closing discards it', () => {
  const ui = setup('flight')
  ui.context.uploadCertificate = () => { throw new Error('must not upload on selection') }
  const file = { name: 'ticket.pdf', type: 'application/pdf', size: 100 }
  ui.context.select(file)
  assert.equal(ui.context.pendingCertificate, file)
  assert.equal(ui.context.isSaving, false)
  assert.equal(ui.writes.length, 0)
  ui.context.close()
  assert.equal(ui.context.pendingCertificate, null)
  assert.deepEqual(ui.closed, [null])
})
for (const kind of ['flight', 'booking']) {
  test(`${kind}: save uploads before writing the attachment to the correct record`, async () => {
    const ui = setup(kind)
    const file = { name: 'ticket.pdf', type: 'application/pdf', size: 100 }
    const attachment = { url: 'https://example.com/ticket', name: 'ticket.pdf', type: file.type }
    ui.context.dataDraft = { title: 'test', label: 'Hotel' }
    ui.context.pendingCertificate = file
    ui.context.uploadCertificate = async selected => {
      assert.equal(selected, file)
      assert.equal(ui.writes.length, 0)
      return attachment
    }
    await ui.save()
    assert.deepEqual(ui.writes[0].data[fields[kind]][1].attachment, attachment)
    assert.equal(ui.context.pendingCertificate, null)
  })
}
test('upload failure preserves the selected file and never writes the document', async () => {
  const ui = setup('flight')
  ui.context.dataDraft = { title: 'test' }
  ui.context.pendingCertificate = { name: 'ticket.pdf' }
  ui.context.uploadCertificate = async () => { throw new Error('timeout') }
  await ui.save()
  assert.equal(ui.writes.length, 0)
  assert.equal(ui.closed.length, 0)
  assert.equal(ui.context.pendingCertificate.name, 'ticket.pdf')
  assert.equal(ui.context.isSaving, false)
})
test('document failure retains uploaded metadata so retry does not upload again', async () => {
  let attempts = 0, uploads = 0
  const ui = setup('flight', async () => { if (++attempts === 1) throw new Error('write failed') })
  ui.context.dataDraft = { title: 'test' }
  ui.context.pendingCertificate = { name: 'ticket.pdf' }
  ui.context.uploadCertificate = async () => { uploads++; return { url: 'https://example.com/ticket', name: 'ticket.pdf', type: 'application/pdf' } }
  await ui.save()
  assert.equal(ui.closed.length, 0)
  await ui.save()
  assert.equal(uploads, 1)
  assert.equal(ui.writes[1].data.flightInfo[1].attachment.url, 'https://example.com/ticket')
  assert.deepEqual(ui.closed, [null])
})

test('personal preparation save fans out selected members while todo remains shared', async () => {
  for (const mode of ['行李', '想去', '採購', '待辦']) {
    const ui = setup('task')
    ui.context.dataEditor.index = null
    ui.context.dataDraft = { title: '準備', mode, assignees: '["全體"]', done: 'false' }
    await ui.save()
    const created = ui.writes[0].data.planningTasks.slice(2)
    assert.equal(created.length, mode === '待辦' ? 1 : 2)
    if (mode !== '待辦') assert.deepEqual(Array.from(created, item => item.assignee), ['A', 'B'])
  }
})
test('task edit replaces the selected record and retains neighboring records', async () => {
  const ui = setup('task')
  ui.context.dataDraft = { title: '更新', mode: '行李', assignees: '["A","B"]', done: 'true' }
  await ui.save()
  const tasks = ui.writes[0].data.planningTasks
  assert.equal(tasks.length, 3)
  assert.equal(tasks[0].id, 'keep')
  assert.equal(tasks[1].done, true)
  assert.equal(tasks[2].done, true)
})
test('empty assignee selection cannot silently create group records', async () => {
  const ui = setup('task')
  ui.context.dataDraft = { title: '準備', mode: '行李', assignees: '[]' }
  await ui.save()
  assert.equal(ui.writes.length, 0)
  assert.equal(ui.errors.length, 1)
})
test('voucher usage writes only selected card and persists after editor save', async () => {
  const ui = setup('booking')
  ui.original.bookingCards[1].used = false
  await ui.context.toggleVoucher(1)
  assert.equal(ui.writes[0].data.bookingCards[1].used, true)
  assert.equal(ui.writes[0].data.bookingCards[0].id, 'keep')
  ui.context.tripData = ui.writes[0].data
  ui.context.dataDraft = { title: '憑證', label: 'Voucher' }
  await ui.save()
  assert.equal(ui.writes[1].data.bookingCards[1].used, true)
})
test('failed voucher toggle preserves displayed data and allows retry', async () => {
  const ui = setup('booking', async () => { throw new Error('write failed') })
  await ui.context.toggleVoucher(1)
  assert.equal(ui.updates.length, 0)
  assert.equal(ui.original.bookingCards[1].used, undefined)
  assert.equal(ui.context.isSaving, false)
})
test('completing one personal preparation record leaves the other unfinished', async () => {
  const ui = setup('task')
  ui.original.planningTasks = [{ title: '準備', assignee: 'A', done: false }, { title: '準備', assignee: 'B', done: false }]
  await ui.context.toggleTask(0)
  assert.equal(ui.writes[0].data.planningTasks[0].done, true)
  assert.equal(ui.writes[0].data.planningTasks[1].done, false)
})
