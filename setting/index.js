import { HISTORY_KEY, readHistory, editRecord, deleteRecord } from '../lib/history'
import { duration } from '../lib/trip'

function dateLabel(ms) {
  const d = new Date(ms)
  const pad = n => n < 10 ? '0' + n : String(n)
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + '  ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}
AppSettingsPage({
  build(props) {
    const storage = props.settingsStorage
    const load = () => readHistory(storage.getItem(HISTORY_KEY))
    const save = h => storage.setItem(HISTORY_KEY, JSON.stringify(h))
    const history = load()
    const confirmId = storage.getItem('speedometer.deleteConfirm') || ''
    const synced = Number(storage.getItem('speedometer.lastSync'))
    const content = [
      Text({ style: { fontSize: '24px', fontWeight: 'bold', color: '#eee6da' } }, 'Спидометр'),
      Text({ style: { color: '#a8b1b7', marginTop: '10px' } }, 'История запусков'),
      Text({ style: { color: '#a8b1b7', marginTop: '8px', marginBottom: '16px' } },
        synced ? 'Последняя передача: ' + dateLabel(synced) : 'Откройте Спидометр на часах рядом с подключённым телефоном.'),
      Text({ style: { color: '#a8b1b7', marginBottom: '16px' } },
        'Передача работает при открытом приложении на часах. Финальная запись после выхода может прийти при следующем запуске. Дата показана по времени телефона.')
    ]
    if (!history.records.length) content.push(Text({}, 'Сохранённых запусков пока нет.'))
    history.records.slice(0, 100).forEach(r => {
      const children = [
        Text({ style: { color: '#eee6da', fontWeight: 'bold', fontSize: '18px' } }, dateLabel(r.startedAt)),
        Text({ style: { color: '#a8b1b7', marginTop: '6px' } }, r.closed ? 'Завершён' : 'Последний снимок открытого запуска'),
        Text({ style: { color: '#eee6da', fontSize: '22px', marginTop: '12px' } }, 'Максимум: ' + Math.round(r.max) + ' км/ч'),
        Text({ style: { color: '#eee6da', marginTop: '6px' } }, (r.distance / 1000).toFixed(2) + ' км  ·  ' + duration(r.elapsed)),
        TextInput({ label: 'Название', value: r.title || '', maxLength: 80,
          onChange: value => save(editRecord(load(), r.id, 'title', value)) }),
        TextInput({ label: 'Заметка', value: r.note || '', maxLength: 500,
          onChange: value => save(editRecord(load(), r.id, 'note', value)) }),
        Button({ label: confirmId === r.id ? 'Подтвердить удаление' : 'Удалить',
          style: { background: '#943c32', color: '#fff', borderRadius: '12px', marginTop: '10px' },
          onClick: () => {
            if (storage.getItem('speedometer.deleteConfirm') === r.id) {
              save(deleteRecord(load(), r.id))
              storage.setItem('speedometer.deleteConfirm', '')
            } else storage.setItem('speedometer.deleteConfirm', r.id)
          } })
      ]
      if (confirmId === r.id) children.push(Button({ label: 'Отмена', onClick: () => storage.setItem('speedometer.deleteConfirm', '') }))
      content.push(View({ style: { background: '#171c20', padding: '16px', borderRadius: '14px', marginBottom: '14px' } }, children))
    })
    if (history.records.length > 100) content.push(Text({}, 'Показаны 100 последних записей. Более старые сохранены.'))
    return View({ style: { padding: '20px', background: '#080b0d', color: '#eee6da', minHeight: '100vh' } }, content)
  }
})
