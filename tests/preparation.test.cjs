const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const exportsObject = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/preparation.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exportsObject })
const plain = value => JSON.parse(JSON.stringify(value))
const { createPreparationTasks, normalizePreparationTasks, parseDraftAssignees } = exportsObject

test('shared todo stays one record with multiple assignees', () => {
  const tasks = plain(createPreparationTasks('確認機票', '待辦', ['A', 'B'], ['A', 'B']))
  assert.equal(tasks.length, 1)
  assert.deepEqual(tasks[0].assignees, ['A', 'B'])
})
for (const mode of ['行李', '想去', '採購']) {
  test(`${mode}: selection creates independent personal records`, () => {
    const tasks = plain(createPreparationTasks('清單', mode, ['A', 'B', 'A'], ['A', 'B', 'C']))
    assert.deepEqual(tasks.map(task => task.assignee), ['A', 'B'])
    tasks[0].done = true
    assert.equal(tasks[1].done, false)
  })
  test(`${mode}: all creates one record per current member`, () => {
    const tasks = plain(createPreparationTasks('清單', mode, ['全體'], ['A', 'B', 'C']))
    assert.deepEqual(tasks.map(task => task.assignee), ['A', 'B', 'C'])
    assert.equal(tasks.every(task => task.mode === mode), true)
  })
}
test('legacy individual, shared, and group records preserve completed state', () => {
  const tasks = plain(normalizePreparationTasks([
    { title: '共同', assignee: '全體', done: true },
    { title: '個人', assignee: 'A', done: false, mode: '行李' },
    { title: '全部', assignee: '全體', done: true, mode: '採購' },
  ], ['A', 'B']))
  assert.equal(tasks.length, 4)
  assert.equal(tasks[0].mode, '待辦')
  assert.equal(tasks[0].done, true)
  assert.deepEqual(tasks.slice(2).map(task => task.assignee), ['A', 'B'])
  assert.equal(tasks.slice(2).every(task => task.done), true)
  assert.deepEqual(plain(normalizePreparationTasks(tasks, ['A', 'B'])), tasks)
})
test('empty member list preserves legacy all records', () => {
  assert.equal(normalizePreparationTasks([{ title: '清單', assignee: '全體', mode: '行李', done: false }], []).length, 1)
})
test('draft supports old assignee field and distinguishes empty selection', () => {
  assert.deepEqual(plain(parseDraftAssignees(undefined, 'A')), ['A'])
  assert.deepEqual(plain(parseDraftAssignees('[]')), [])
})

test('legacy owners remain reachable after member rename or removal', () => {
  const pages = exportsObject.getPreparationPages([
    { title: '想去', mode: '想去', assignee: 'OldName', done: false },
    { title: '採購', mode: '採購', assignee: 'Other', done: false },
  ], '想去', ['NewName'])
  assert.deepEqual(plain(pages), ['NewName', 'OldName'])
})
