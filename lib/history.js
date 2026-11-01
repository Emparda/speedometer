export const HISTORY_KEY = 'speedometer.history.v1'
export const OUTBOX_KEY = 'speedometer.outbox.v1'
export function readHistory(raw) {
  try {
    const h = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (h && Array.isArray(h.records) && Array.isArray(h.deleted)) return h
  } catch (_) {}
  return { records: [], deleted: [] }
}
export function validRecord(r) {
  return r && typeof r.id === 'string' && r.id.length < 100 &&
    ['startedAt', 'updatedAt', 'revision', 'max', 'distance', 'elapsed'].every(k =>
      typeof r[k] === 'number' && isFinite(r[k]) && r[k] >= 0)
}
export function mergeRecord(h, incoming) {
  if (!validRecord(incoming)) throw new Error('Invalid history record')
  if (h.deleted.indexOf(incoming.id) >= 0) return h
  const existing = h.records.find(r => r.id === incoming.id)
  if (existing && existing.revision >= incoming.revision) return h
  const r = {
    id: incoming.id, startedAt: incoming.startedAt, updatedAt: incoming.updatedAt,
    revision: incoming.revision, max: incoming.max, distance: incoming.distance,
    elapsed: incoming.elapsed, closed: !!incoming.closed,
    title: existing ? existing.title : '', note: existing ? existing.note : ''
  }
  return { records: h.records.filter(x => x.id !== r.id).concat([r]).sort((a, b) => b.startedAt - a.startedAt), deleted: h.deleted }
}
export function editRecord(h, id, field, value) {
  if (field !== 'title' && field !== 'note') return h
  return { records: h.records.map(r => r.id === id ? { ...r, [field]: String(value).slice(0, field === 'title' ? 80 : 500) } : r), deleted: h.deleted }
}
export function deleteRecord(h, id) {
  return { records: h.records.filter(r => r.id !== id), deleted: h.deleted.indexOf(id) >= 0 ? h.deleted : h.deleted.concat([id]) }
}
export class Outbox {
  constructor(raw) {
    this.records = Array.isArray(raw) ? raw.filter(validRecord).map(r => ({ ...r })) : []
    // Recover a launch interrupted without onDestroy using its last checkpoint.
    this.records.forEach(r => { if (!r.closed) { r.closed = true; r.revision += 1 } })
  }
  put(r) { this.records = this.records.filter(x => x.id !== r.id).concat([{ ...r }]) }
  next() { return this.records.find(r => r.ackRevision !== r.revision) }
  ack(id, revision) {
    this.records = this.records.filter(r => r.id !== id || r.revision !== revision || !r.closed)
    this.records.forEach(r => { if (r.id === id && r.revision === revision) r.ackRevision = revision })
  }
}
