import { BaseSideService } from '@zeppos/zml/base-side'
import { HISTORY_KEY, readHistory, mergeRecord } from '../lib/history'

AppSideService(BaseSideService({
  onRequest(req, res) {
    if (req.method !== 'history.put') { res('Unknown request'); return }
    try {
      const record = req.params.record
      const history = readHistory(settings.settingsStorage.getItem(HISTORY_KEY))
      const next = mergeRecord(history, record)
      settings.settingsStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      settings.settingsStorage.setItem('speedometer.lastSync', String(Date.now()))
      // Acknowledge only after persistent storage succeeds, including tombstones.
      res(null, { id: record.id, revision: record.revision })
    } catch (_) { res('History could not be saved') }
  }
}))
