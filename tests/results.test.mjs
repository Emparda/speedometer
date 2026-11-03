import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const src=readFileSync(new URL('../lib/results.js',import.meta.url),'utf8')
const { readResults,saveResult,deleteResults }=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'))
const row=i=>({id:String(i),savedAt:i,max:36,distance:30,elapsed:3000})
test('storage roundtrip and strict validation',()=>{
  assert.deepEqual(readResults(JSON.stringify([row(1)])),[row(1)])
  for(const bad of ['bad',{},[row(1),row(1)],[{...row(1),distance:-1}],Array.from({length:21},(_,i)=>row(i))])assert.throws(()=>readResults(bad))
})
test('full storage is unchanged until explicit deletion',()=>{
  const rows=Array.from({length:20},(_,i)=>row(i));let writes=0
  const storage={setItem(){writes++}}
  assert.equal(saveResult(storage,rows,row(21)).reason,'full');assert.equal(writes,0)
  const smaller=deleteResults(storage,rows,['0','1']);assert.equal(smaller.length,18)
  assert.equal(saveResult(storage,smaller,row(21)).records.length,19)
  assert.equal(rows.length,20)
})
