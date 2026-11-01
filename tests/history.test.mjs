import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../lib/history.js', import.meta.url), 'utf8')
const lib = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
const { Outbox, readHistory, mergeRecord, editRecord, deleteRecord, HISTORY_KEY } = lib
const record = (revision = 1) => ({ id: 'test-1', startedAt: 1000, updatedAt: 2000, revision, max: 36, distance: 30, elapsed: 3000, closed: false })
test('retries are idempotent and old snapshots cannot overwrite newer data', () => {
  let h = mergeRecord(readHistory(), record(2))
  h = mergeRecord(h, record(2)); h = mergeRecord(h, record(1))
  assert.equal(h.records.length, 1); assert.equal(h.records[0].revision, 2)
})
test('phone edits survive newer watch snapshots; metrics cannot be edited', () => {
  let h = mergeRecord(readHistory(), record())
  h = editRecord(h, 'test-1', 'title', 'Поездка домой')
  h = editRecord(h, 'test-1', 'note', 'На автобусе')
  h = editRecord(h, 'test-1', 'max', 999)
  h = mergeRecord(h, { ...record(2), max: 40 })
  assert.equal(h.records[0].title, 'Поездка домой'); assert.equal(h.records[0].note, 'На автобусе')
  assert.equal(h.records[0].max, 40)
})
test('deleted launch stays deleted after late updates and repeated reconnect', () => {
  let h = deleteRecord(mergeRecord(readHistory(), record()), 'test-1')
  h = mergeRecord(h, record(5)); h = mergeRecord(h, { ...record(6), closed: true })
  assert.equal(h.records.length, 0); assert.deepEqual(h.deleted, ['test-1'])
})
test('outbox retains newer checkpoints when old acknowledgements arrive', () => {
  const q = new Outbox(); q.put(record(1)); q.put(record(2)); q.ack('test-1', 1)
  assert.equal(q.next().revision, 2)
  q.ack('test-1', 2); assert.equal(q.next(), undefined)
  const recovered = new Outbox(q.records)
  assert.equal(recovered.next().closed, true); assert.equal(recovered.next().revision, 3)
  recovered.ack('test-1', 3); assert.equal(recovered.records.length, 0)
})
test('side service persists before ack; a storage failure returns an error', () => {
  let service, fail = false
  const data = new Map()
  const sideSource = readFileSync(new URL('../app-side/index.js', import.meta.url), 'utf8').replace(/^import [^\n]*\n/gm, '')
  vm.runInNewContext(sideSource, { ...lib, BaseSideService: x => x, AppSideService: x => { service = x },
    settings: { settingsStorage: { getItem: k => data.get(k), setItem: (k,v) => { if (fail) throw Error('full'); data.set(k,v) } } } })
  let error, ack
  service.onRequest({ method: 'history.put', params: { record: record() } }, (e,a) => { error=e; ack=a })
  assert.equal(error, null); assert.equal(ack.id, 'test-1'); assert.equal(readHistory(data.get(HISTORY_KEY)).records.length, 1)
  fail = true
  service.onRequest({ method: 'history.put', params: { record: record(2) } }, e => { error=e })
  assert.ok(error)
})
test('settings page renders records and requires confirmation to delete', () => {
  let page
  const data = new Map([[HISTORY_KEY, JSON.stringify(mergeRecord(readHistory(), record()))]])
  const component = type => (props, children) => ({ type, props, children })
  const settingSource = readFileSync(new URL('../setting/index.js', import.meta.url), 'utf8').replace(/^import [^\n]*\n/gm, '')
  vm.runInNewContext(settingSource, { ...lib, duration: () => '00:00:03', AppSettingsPage: x => { page=x },
    Text: component('text'), View: component('view'), TextInput: component('input'), Button: component('button') })
  const props = { settingsStorage: { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v) } }
  const flatten = x => [x].concat((x.children && Array.isArray(x.children) ? x.children : []).flatMap(flatten))
  let nodes = flatten(page.build(props))
  nodes.find(n => n.type === 'input' && n.props.label === 'Название').props.onChange('Тест')
  assert.equal(readHistory(data.get(HISTORY_KEY)).records[0].title, 'Тест')
  nodes.find(n => n.type === 'button' && n.props.label === 'Удалить').props.onClick()
  assert.equal(readHistory(data.get(HISTORY_KEY)).records.length, 1)
  nodes = flatten(page.build(props))
  nodes.find(n => n.type === 'button' && n.props.label === 'Подтвердить удаление').props.onClick()
  assert.equal(readHistory(data.get(HISTORY_KEY)).records.length, 0)
})
