import type { Config, ToolId } from '../../shared/types.ts';
import { AppError, ensure, ERROR_CODES, withErrorCode } from '../../shared/errors.ts';
import { matchesSchema } from '../judge/index.ts';
import { validateSchemaDefinition } from '../workflow/validate.ts';
export function calculate(expression:string):number {
  return withErrorCode(ERROR_CODES.INVALID_WORKFLOW, () => calculateInternal(expression));
}
function calculateInternal(expression:string):number {
  ensure(expression.length<=256,'Expression is too long.');
  const tokens=expression.match(/(?:\d+(?:\.\d+)?|\.\d+)|[()+\-*/%]/g)||[];
  ensure(tokens.join('')===expression.replace(/\s/g,''),'Only arithmetic is supported.');ensure(tokens.length>0&&tokens.length<=128,'Invalid expression.');
  let i=0,depth=0;
  const atom=():number=>{ensure(++depth<=16,'Expression is too deeply nested.');let v:number;const t=tokens[i++];
    if(t==='('){v=sum();ensure(tokens[i++]===')','Missing closing parenthesis.');}
    else if(t==='+'||t==='-')v=(t==='-'?-1:1)*atom();
    else {v=Number(t);ensure(t!==undefined&&/^\d*\.?\d+$/.test(t)&&Number.isFinite(v),'Invalid number.');}
    depth--;return v;
  };
  const product=():number=>{let v=atom();while(['*','/','%'].includes(tokens[i])){const op=tokens[i++],r=atom();ensure(!(r===0&&op!=='*'),'Division by zero.');v=op==='*'?v*r:op==='/'?v/r:v%r;}return v;};
  const sum=():number=>{let v=product();while(['+','-'].includes(tokens[i])){const op=tokens[i++],r=product();v=op==='+'?v+r:v-r;}return v;};
  const result=sum();ensure(i===tokens.length&&Number.isFinite(result)&&Math.abs(result)<=1e15,'Invalid or oversized arithmetic result.');return result;
}
export function parseIsoDate(text:string):string|null {
  const m=text.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return null;
  const d=new Date(`${m[0]}T00:00:00.000Z`);return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===m[0]?d.toISOString():null;
}
export function executeSafeTool(id:ToolId,text:string,config:Config={}):unknown {
  return withErrorCode(ERROR_CODES.INVALID_WORKFLOW, () => executeSafeToolInternal(id, text, config));
}
function executeSafeToolInternal(id:ToolId,text:string,config:Config={}):unknown {
  ensure(text.length<=32000,'Tool input exceeds the limit.');
  if(id==='calculator')return {result:calculate(config.expression||text)};
  if(id==='json-validator'){try{const value=JSON.parse(text);if(config.schema)validateSchemaDefinition(config.schema);return {valid:!config.schema||matchesSchema(value,config.schema)};}catch{return {valid:false};}}
  if(id==='text-search'){const query=(config.query||'').slice(0,256);ensure(query.length>0,'Text Search requires a query.');const lower=text.toLowerCase(),q=query.toLowerCase(),indices:number[]=[];let i=0;while((i=lower.indexOf(q,i))>=0&&indices.length<100){indices.push(i);i+=q.length;}return {matches:indices.length,indices};}
  if(id==='date-parser')return {iso:parseIsoDate(text)};
  if(id==='string-matcher'){const match=(config.match||'').slice(0,256);return {matches:config.mode==='exact'?text===match:text.includes(match)};}
  throw new AppError('Tool is not registered.', 400, ERROR_CODES.INVALID_WORKFLOW);
}
