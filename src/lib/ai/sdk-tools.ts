import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { ToolId } from '../../shared/types';
import { executeSafeTool } from './tools-core';
export function sdkTools(ids:ToolId[],consume:()=>void):ToolSet {
  const registry={
    calculator:tool({description:'Evaluate bounded arithmetic. No code execution.',inputSchema:z.object({expression:z.string().max(256)}),execute:async({expression})=>{consume();return executeSafeTool('calculator',expression);}}),
    json_validator:tool({description:'Validate JSON with an optional supported schema.',inputSchema:z.object({text:z.string().max(32000),schema:z.record(z.string(),z.unknown()).optional()}),execute:async({text,schema})=>{consume();return executeSafeTool('json-validator',text,{schema});}}),
    text_search:tool({description:'Search supplied text for a literal phrase.',inputSchema:z.object({text:z.string().max(32000),query:z.string().min(1).max(256)}),execute:async({text,query})=>{consume();return executeSafeTool('text-search',text,{query});}}),
    date_parser:tool({description:'Parse an exact YYYY-MM-DD date.',inputSchema:z.object({value:z.string().max(32)}),execute:async({value})=>{consume();return executeSafeTool('date-parser',value);}}),
    string_matcher:tool({description:'Compare text with a literal string.',inputSchema:z.object({text:z.string().max(32000),match:z.string().max(256),mode:z.enum(['exact','contains'])}),execute:async({text,match,mode})=>{consume();return executeSafeTool('string-matcher',text,{match,mode});}})
  };
  return Object.fromEntries(ids.map(id=>{const key=id.replaceAll('-','_') as keyof typeof registry;return [key,registry[key]];}));
}
