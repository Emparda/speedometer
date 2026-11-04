import { readFileSync } from 'node:fs'
import vm from 'node:vm'
async function moduleAt(name) {
  return import('data:text/javascript;base64,' + Buffer.from(readFileSync(new URL('../lib/' + name + '.js', import.meta.url), 'utf8')).toString('base64'))
}
const math = await moduleAt('measurement'), results = await moduleAt('results')
export const RESULTS_KEY = results.RESULTS_KEY
export const result = i => ({ id: 'r' + i, savedAt: 1793640000000 + i, max: 85, distance: 12480, elapsed: 1122000 })
export function harness(options = {}) {
  let page, app, now = 1000, nextTimer = 0, scrollLocked = true, rootOffset = 0
  const scrollLocks = []
  const data = options.data || new Map(options.records ? [[RESULTS_KEY, JSON.stringify(options.records)]] : [])
  const writes = [], widgets = [], timers = new Map(), input = { key: null, gesture: null }, toasts = []
  const activity = { timerCallbacks: 0, uiWrites: 0, gpsReads: 0, gpsStarts: 0, gpsStops: 0 }
  const enumProxy = new Proxy({}, { get: (_, key) => key })
  const ui = { widget: enumProxy, align: enumProxy, prop: enumProxy, event: enumProxy, anim_status: enumProxy,
    createWidget(type, props) {
      const w = { type, ...props, children: [], events: {},
        setProperty(k, v) {
          if(this.deleted)throw Error('Write to deleted widget')
          activity.uiWrites++
          if(k==='MORE')Object.assign(this,v);else this[k.toLowerCase()] = v
        },
        setEnable(value) { this.enabled=value },
        getProperty(k) { return this[k.toLowerCase()] || 0 },
        createWidget(t, p) { const child = ui.createWidget(t,p); child.parent=this; this.children.push(child); return child },
        addEventListener(k, v) { this.events[k] = v } }
      widgets.push(w); return w
    }, deleteWidget(w) { for(const c of w.children) ui.deleteWidget(c); const i=widgets.indexOf(w); if(i<0) throw Error('Widget deleted twice'); widgets.splice(i,1); w.deleted=true } }
  let gps, screenSensor, lastFix
  class GPS {
    constructor(){gps=this;this.running=false;this.callback=null}
    onChange(cb){this.callback=cb;lastFix=cb} start(){this.running=true;activity.gpsStarts++}
    offChange(){this.callback=null} stop(){this.running=false;activity.gpsStops++}
    getStatus(){activity.gpsReads++;return 'A'} getLatitude(){return 0}
    getLongitude(){return (now-1000)/1000*10/6371000*180/Math.PI}
  }
  class Display { constructor(){screenSensor=this;this.status=1} getStatus(){return this.status} onChange(cb){this.callback=cb} offChange(){this.callback=null} }
  class Storage { getItem(k){return data.get(k)} setItem(k,v){if(options.failWrites)throw Error('full');writes.push(k);data.set(k,v)} }
  class Clock extends Date { constructor(...args){super(...(args.length?args:[now]))} static now(){return now} }
  const interaction = new Proxy({
    onKey({callback}){input.key=callback},offKey(){input.key=null},
    onGesture({callback}){input.gesture=callback},offGesture(){input.gesture=null},
    showToast({content}){toasts.push(content)}
  },{get:(o,k)=>k in o?o[k]:k})
  const nop=()=>{}
  const context={ ...math,...results,ui,interaction,Date:Clock,LocalStorage:Storage,Geolocation:GPS,Screen:Display,
    getApp:()=>({_options:app}),App:a=>{app=a},Page:p=>{page=p},
    setScrollLock({lock}){scrollLocked=lock;scrollLocks.push(lock)},setPageBrightTime:nop,resetPageBrightTime:nop,pauseDropWristScreenOff:nop,resetDropWristScreenOff:nop,
    setInterval(cb,ms){const id=++nextTimer;timers.set(id,{cb,ms,at:now+ms,repeat:true});return id},
    setTimeout(cb,ms){const id=++nextTimer;timers.set(id,{cb,ms,at:now+ms,repeat:false});return id},
    clearInterval:id=>timers.delete(id),clearTimeout:id=>timers.delete(id)
  }
  vm.runInNewContext(readFileSync(new URL('../app.js',import.meta.url),'utf8'),context)
  const src=readFileSync(new URL('../page/index.js',import.meta.url),'utf8').replace(/^import [^\n]*\n/gm,'')
  vm.runInNewContext(src,context);page.build()
  const advance=t=>{now=t;for(const [id,timer] of [...timers])if(timers.has(id)&&timer.at<=now){if(timer.repeat)timer.at=now+timer.ms;else timers.delete(id);activity.timerCallbacks++;timer.cb()}}
  return {page,app,data,writes,widgets,gps,screenSensor,input,toasts,activity,scrollLocks,
    rootOffset:()=>rootOffset,
    nativeDrag(dy, list=false){
      if(list && page.list) {
        const w=page.list
        w.setProperty('POS_Y',Math.max(-page.maxOffset(),Math.min(0,w.getProperty('POS_Y')+dy)))
        w.scroll_frame_func()
      } else if(!scrollLocked) rootOffset+=dy
    },
    activeTimers:()=>timers.size,
    fix(){gps.callback?.()},lateFix(){lastFix?.()},
    click(label){const w=widgets.find(w=>w.type==='BUTTON'&&w.text===label);if(!w)throw Error('Missing button '+label);w.click_func()},
    key(key){return input.key?.(key,'KEY_EVENT_CLICK')},swipe(event){return input.gesture?.(event)},
    screen(status){screenSensor.status=status;screenSensor.callback?.(status)},
    cards(){return widgets.filter(w=>w.type==='FILL_RECT'&&w.w===348)},
    advance, elapse(ms){advance(now+ms)}, settle(){advance(now+400)},
    go(direction){page.navigate(direction);advance(now+400)}
  }
}
