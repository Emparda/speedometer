import { HISTORY_KEY, readHistory, editRecord, deleteRecord } from '../lib/history'
import { duration } from '../lib/trip'

// Zepp Text may render inline; layout belongs to explicit block containers.
function blockText(props, text) {
  return View({ style: { display: 'block', lineHeight: '1.5', ...((props && props.style) || {}) } }, [
    Text({ style: { display: 'block' } }, text)
  ])
}
function row(child) {
  return View({ style: { display: 'block', width: '100%', marginTop: '12px', boxSizing: 'border-box' } }, [child])
}
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
      blockText({ style: { fontSize: '24px', fontWeight: 'bold', color: '#eee6da' } }, 'История запусков'),
      blockText({ style: { color: '#a8b1b7', marginTop: '8px', marginBottom: '16px' } },
        synced ? 'Последняя передача: ' + dateLabel(synced) : 'Откройте Спидометр на часах рядом с подключённым телефоном.'),
      blockText({ style: { color: '#a8b1b7', marginBottom: '16px' } },
        'Для синхронизации откройте Спидометр на часах. Время записей — по телефону.')
    ]
    if (!history.records.length) content.push(blockText({}, 'Сохранённых запусков пока нет.'))
    history.records.slice(0, 100).forEach(r => {
      const children = [
        blockText({ style: { color: '#eee6da', fontWeight: 'bold', fontSize: '18px' } }, dateLabel(r.startedAt)),
        blockText({ style: { color: '#a8b1b7', marginTop: '6px' } }, r.closed ? 'Завершён' : 'Запуск ещё не завершён'),
        blockText({ style: { color: '#eee6da', fontSize: '22px', marginTop: '12px' } }, 'Максимум: ' + Math.round(r.max) + ' км/ч'),
        blockText({ style: { color: '#eee6da', marginTop: '6px' } }, 'Расстояние: ' + (r.distance / 1000).toFixed(2) + ' км'),
        blockText({ style: { color: '#eee6da', marginTop: '6px' } }, 'Время: ' + duration(r.elapsed)),
        TextInput({ label: 'Название', labelStyle: { color: '#eee6da' }, subStyle: { color: '#a8b1b7' }, placeholder: 'Добавить название', value: r.title || '', maxLength: 80,
          onChange: value => save(editRecord(load(), r.id, 'title', value)) }),
        TextInput({ label: 'Заметка', labelStyle: { color: '#eee6da' }, subStyle: { color: '#a8b1b7' }, placeholder: 'Добавить заметку', multiline: true, value: r.note || '', maxLength: 500,
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
      content.push(View({ style: { background: '#171c20', padding: '16px', borderRadius: '14px', marginBottom: '14px' } }, children.map(row)))
    })
    if (history.records.length > 100) content.push(blockText({}, 'Показаны 100 последних записей. Более старые сохранены.'))
    return View({ style: { padding: '20px', background: '#080b0d', color: '#eee6da', minHeight: '100vh' } }, content)
  }
})
