import { z } from 'zod';
import { AppError, ERROR_CODES } from '../shared/errors.ts';
const id=z.string().min(1).max(100),short=z.string().min(1).max(160);
const schemas:Record<string,z.ZodType>={
  builds:z.object({buildId:id.optional(),currentVersionId:id.optional(),problemId:id,title:z.string().min(1).max(80),visibility:z.enum(['public','private']),workflow:z.object({nodes:z.array(z.unknown()).min(3).max(24),edges:z.array(z.unknown()).max(64)})}).strict(),
  providers:z.object({name:z.string().min(1).max(60),baseUrl:z.url().max(300),modelId:short,apiKey:z.string().min(16).max(512),inputPrice:z.number().min(0).max(10000).nullable().optional(),outputPrice:z.number().min(0).max(10000).nullable().optional()}).strict(),
  runs:z.object({buildId:id,kind:z.enum(['public','hidden']),consent:z.boolean().optional()}).strict(),
  'failure-cases':z.object({problemId:id,input:z.string().min(1).max(4000),reason:z.string().min(8).max(1000),providerId:id,consent:z.boolean().optional()}).strict(),
  problems:z.object({title:z.string().min(5).max(100),description:z.string().min(20).max(3000),why:z.string().min(10).max(2000),exampleInput:z.string().min(1).max(4000),expectedOutput:z.string().min(1).max(4000),category:z.string().min(1).max(60)}).strict(),
  'pi-self-test':z.object({
    intent:z.enum(['apply','run']),
    prompt:z.string().min(1).max(2000).optional(),
    credentialId:z.string().min(1).max(100).optional(),
    consent:z.boolean().optional()
  }).strict()
};
export function validateBody(path:string,body:Record<string,unknown>){const schema=schemas[path];if(schema&&!schema.safeParse(body).success)throw new AppError('Invalid request fields. Check the form values and length limits.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);}
