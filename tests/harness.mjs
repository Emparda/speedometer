import { readFileSync } from 'node:fs'
import vm from 'node:vm'
async function moduleAt(name) {
  return import('data:text/javascript;base64,' + Buffer.from(readFileSync(new URL('../lib/' + name + '.js', import.meta.url), 'utf8')).toString('base64'))
}
const math = await moduleAt('measurement'), results = await moduleAt('results')
export const RESULTS_KEY = results.RESULTS_KEY
export const result = i => ({ id: 'r' + i, savedAt: 1793640000000 + i, max: 85, distance: 12480, elapsed: 1122000 })
export function harness(options = {}) {
  let page, app, now = 1000, nextTimer = 0
  const data = options.data || new Map(options.records ? [[RESULTS_KEY, JSON.stringify(options.records)]] : [])
  const writes = [], widgets = [], timers = new Map(), input = { key: null, gesture: null }, toasts = []
  const enumProxy = new Proxy({}, { get: (_, key) => key })
  const ui = { widget: enumProxy, align: enumProxy, prop: enumProxy, event: enumProxy, anim_status: enumProxy,
    createWidget(type, props) {
      const w = { type, ...props, events: {}, setProperty(k, v) { this[k === 'TEXT' ? 'text' : k] = v }, addEventListener(k, v) { this.events[k] = v } }
      widgets.push(w); return w
    }, deleteWidget(w) { const i=widgets.indexOf(w); if(i<0) throw Error('Widget deleted twice'); widgets.splice(i,1) } }
  let gps, screenSensor, lastFix
  class GPS {
    constructor(){gps=this;this.running=false;this.callback=null}
    onChange(cb){this.callback=cb;lastFix=cb} start(){this.running=true}
    offChange(){this.callback=null} stop(){this.running=false}
    getStatus(){return 'A'} getLatitude(){return 0}
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
    setScrollLock:nop,setPageBrightTime:nop,resetPageBrightTime:nop,pauseDropWristScreenOff:nop,resetDropWristScreenOff:nop,
    setInterval(cb,ms){const id=++nextTimer;timers.set(id,{cb,ms,at:now+ms,repeat:true});return id},
    setTimeout(cb,ms){const id=++nextTimer;timers.set(id,{cb,ms,at:now+ms,repeat:false});return id},
    clearInterval:id=>timers.delete(id),clearTimeout:id=>timers.delete(id)
  }
  vm.runInNewContext(readFileSync(new URL('../app.js',import.meta.url),'utf8'),context)
  const src=readFileSync(new URL('../page/index.js',import.meta.url),'utf8').replace(/^import [^\n]*\n/gm,'')
  vm.runInNewContext(src,context);page.build()
  return {page,app,data,writes,widgets,gps,screenSensor,input,toasts,
    activeTimers:()=>timers.size,
    fix(){gps.callback?.()},lateFix(){lastFix?.()},
    click(label){const w=widgets.find(w=>w.type==='BUTTON'&&w.text===label);if(!w)throw Error('Missing button '+label);w.click_func()},
    key(key){return input.key?.(key,'KEY_EVENT_CLICK')},swipe(event){return input.gesture?.(event)},
    screen(status){screenSensor.status=status;screenSensor.callback?.(status)},
    cards(){return widgets.filter(w=>w.type==='FILL_RECT'&&w.w===348)},
    advance(t){now=t;for(const [id,timer] of [...timers])if(timers.has(id)&&timer.at<=now){if(timer.repeat)timer.at=now+timer.ms;else timers.delete(id);timer.cb()}}
  }
}
