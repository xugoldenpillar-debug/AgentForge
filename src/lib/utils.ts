import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs:ClassValue[]){return twMerge(clsx(inputs));}
export const money=(cost:number|null|undefined)=>cost==null?'unknown':cost===0?'$0.00':`$${cost.toFixed(cost<.01?5:3)}`;
export const number=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
export const percent=(n:number)=>`${(n*100).toFixed(1)}%`;
export const duration=(ms:number)=>ms<1000?`${Math.round(ms)}ms`:`${(ms/1000).toFixed(2)}s`;
