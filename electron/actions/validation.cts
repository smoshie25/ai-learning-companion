import { createHash } from 'node:crypto'
import { actionPayloadSchema,type ActionPayload,type CalendarAction } from '../../shared/action-contracts.cjs'
import { AppError } from '../ai/errors.cjs'
export function actionDigest(action:ActionPayload){const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;return createHash('sha256').update(JSON.stringify(canonical(action))).digest('hex')}
function offsetAt(instant:Date,zone:string){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(instant);const get=(key:string)=>Number(parts.find(p=>p.type===key)?.value);return Math.round((Date.UTC(get('year'),get('month')-1,get('day'),get('hour'),get('minute'),get('second'))-Math.floor(instant.getTime()/1000)*1000)/60000)}
export function validateCalendar(data:CalendarAction,future=true){
 const start=new Date(data.start),end=new Date(data.end)
 if(!Number.isFinite(start.getTime())||end.getTime()<=start.getTime()||end.getTime()-start.getTime()>8*3600000)throw new AppError('INVALID_DATE','Study events need a valid end after start, within eight hours.')
 for(const value of [data.start,data.end]){const match=value.match(/([+-])(\d\d):(\d\d)$/);const offset=match?(match[1]==='-'?-1:1)*(Number(match[2])*60+Number(match[3])):0;if(offset!==offsetAt(new Date(value),data.timeZone))throw new AppError('INVALID_TIME_ZONE','The date offset does not match the selected IANA time zone, including daylight-saving time.')}
 if(future&&(start.getTime()<=Date.now()||start.getTime()-Date.now()>5*366*86400000||start.getTime()-data.reminderMinutes*60000<=Date.now()))throw new AppError('INVALID_DATE','Choose a future event and reminder time within five years.')
}
export function validateAction(value:unknown,future=true){const result=actionPayloadSchema.safeParse(value);if(!result.success)throw new AppError('INVALID_ACTION','Recipients, dates, time zones, or action fields are invalid.');const a=result.data;if(a.kind==='email')a.data.to=a.data.to.map(v=>v.toLowerCase());if(a.kind==='calendar_event'||a.kind==='calendar_reminder')validateCalendar(a.data,future);return a}
