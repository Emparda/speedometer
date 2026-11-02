export const RESULTS_KEY = 'speedometer.results.v2'
export const MAX_RESULTS = 20
export function validResult(r) {
  return r && typeof r.id === 'string' && r.id.length < 100 &&
    ['savedAt', 'max', 'distance', 'elapsed'].every(k => typeof r[k] === 'number' && isFinite(r[k]) && r[k] >= 0)
}
export function readResults(raw) {
  if (raw === undefined || raw === null || raw === '') return []
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!Array.isArray(value) || value.length > MAX_RESULTS || !value.every(validResult) ||
      new Set(value.map(r => r.id)).size !== value.length) throw new Error('Invalid saved results')
  return value.map(r => ({ ...r }))
}
export function dateLabel(ms) {
  const d = new Date(ms)
  const pad = n => n < 10 ? '0' + n : String(n)
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + '  ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}
export function saveResult(storage, records, result) {
  if (records.length >= MAX_RESULTS) return { ok: false, reason: 'full' }
  if (!validResult(result) || records.some(r => r.id === result.id)) return { ok: false, reason: 'invalid' }
  const next = [result, ...records]
  storage.setItem(RESULTS_KEY, JSON.stringify(next))
  return { ok: true, records: next }
}
export function deleteResults(storage, records, selected) {
  const next = records.filter(r => selected.indexOf(r.id) < 0)
  storage.setItem(RESULTS_KEY, JSON.stringify(next))
  return next
}
