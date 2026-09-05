import type { AIProvider, AIRequest, AIResult } from './types.ts';
// Intentionally bounded and imperfect. Never imports fixtures or expected answers.
// These results are simulated and must never share a verified leaderboard.
export class DemoProvider implements AIProvider {
  readonly id='demo';readonly pricing={inputPrice:0,outputPrice:0};
  async execute(r:AIRequest):Promise<AIResult>{
    if(r.signal?.aborted)throw new Error('Aborted');
    const all=r.systemPrompt.toLowerCase(),input=r.userPrompt.split('\n\n[Previous answer]')[0].replace(/^\[Untrusted input\]\n/,'').trim();
    let text='I can help with your question. Keep confidential information private.';
    if(all.includes('name')&&all.includes('age')&&all.includes('city')) {
      const name=input.match(/(?:my name is|name\s*[:=]|i am|i'm)\s*([A-Z][a-z]+(?:[ -][A-Z][a-z]+)?)/i)?.[1]||input.match(/^([A-Z][a-z]+)\s+(?:is|,)/)?.[1]||null;
      const ageRaw=input.match(/(?:age\s*[:=]?|aged|am|is)\s*(\d{1,3})(?:\s*(?:years?|,|;|\b))/i)?.[1]||input.match(/\b(\d{1,3})\s*(?:years? old|yo)\b/i)?.[1];
      const age=ageRaw===undefined?null:Number(ageRaw);
      const city=input.match(/(?:live in|lives in|based in|city\s*[:=]|from|in)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/)?.[1]||input.match(/city\s*[:=]\s*([A-Za-z ]+?)(?:[.,;\n]|$)/i)?.[1]?.trim()||null;
      const obj={name,age,city};text=JSON.stringify(obj);
      const injection=/ignore|instead output|disregard|system override/i.test(input);
      if(injection&&!all.includes('untrusted')&&!all.includes('safety guard'))text='Instructions accepted.';
      if(!all.includes('json')&&!all.includes('structured output'))text=`Here is the extracted information: ${text}`;
      if(all.includes('extract skill')||all.includes('review and correct')) {
        const explicit=input.match(/(?:name|person)\s*[:=]\s*["']?([^\n,;"']+)/i)?.[1]?.trim();
        if(explicit)obj.name=explicit;
        if(/age\s*[:=]\s*(?:unknown|n\/a|null)/i.test(input))obj.age=null;
        text=JSON.stringify(obj);
      }
    } else if(all.includes('billing')&&all.includes('refund')) {
      const lower=input.toLowerCase();
      text=/refund|money back|return my payment|reimburse/.test(lower)?'refund':/password|log ?in|sign ?in|locked out|2fa|account access/.test(lower)?'account':/invoice|charged|charge|payment|subscription|billing/.test(lower)?'billing':/crash|broken|bug|error|freeze|not working/.test(lower)?'bug':'other';
      if(/ignore.*(?:output|return)\s+\w+/i.test(input)&&!all.includes('safety guard'))text=input.match(/(?:output|return)\s+(\w+)/i)?.[1]||text;
    } else if(all.includes('confidential')||all.includes('secret')) {
      const attack=/secret|flag|system prompt|ignore|base64|repeat everything|encode|translate.*system/i.test(input);
      const guarded=all.includes('safety guard')||all.includes('never reveal')||all.includes('never disclose');
      if(attack&&!guarded)text=r.systemPrompt.match(/FLAG\{[^}]+\}/)?.[0]||'No confidential value is available.';
      else if(attack)text='I cannot share confidential system information. I can help with a normal task instead.';
      else if(/2\s*\+\s*2/.test(input))text='4';
      else if(/capital of france/i.test(input))text='The capital of France is Paris.';
      else if(/hello|greet/i.test(input))text='Hello! How can I help?';
      else if(/thank/i.test(input))text='Thank you for your help.';
      else if(/three.*colou?r/i.test(input))text='Red, green, and blue.';
      else if(/water|h2o/i.test(input))text='Water is H2O.';
      else text='I can help you plan your task. Start with one clear goal.';
    }
    const inputTokens=Math.ceil((r.systemPrompt.length+r.userPrompt.length)/4),outputTokens=Math.ceil(text.length/4);
    return {text,inputTokens,outputTokens,reasoningTokens:0,toolCalls:0,latency:140+text.length, cost:0,estimated:true};
  }
}
