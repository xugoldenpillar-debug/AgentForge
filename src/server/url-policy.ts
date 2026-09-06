import { isIP } from 'node:net';
import { AppError, ensure, ERROR_CODES } from '../shared/errors.ts';
export function isPublicAddress(address:string):boolean {
  const a=address.toLowerCase().replace(/^\[|\]$/g,'');
  if(isIP(a)===4){const [x,y,z]=a.split('.').map(Number);return !(x===0||x===10||x===127||x>=224||(x===100&&y>=64&&y<=127)||(x===169&&y===254)||(x===172&&y>=16&&y<=31)||(x===192&&(y===168||y===0||y===2))||(x===198&&(y===18||y===19||y===51&&z===100))||(x===203&&y===0&&z===113));}
  // Only global unicast IPv6; mapped/private/link-local/multicast are excluded.
  if(isIP(a)===6)return /^[23][0-9a-f]{0,3}:/.test(a)&&!/^2001:(?:db8|0|10|20):/i.test(a)&&!/^2002:/i.test(a);
  return false;
}
export function validateProviderUrl(raw:string,allowedHosts:string[]):URL {
  let url:URL;try{url=new URL(raw);}catch{throw new AppError('Invalid provider URL.',400,ERROR_CODES.PROVIDER_CONFIGURATION_INVALID);}
  ensure(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&!url.search,'Use an HTTPS provider URL without credentials, query parameters or fragments.');
  ensure(!url.port||url.port==='443','Only HTTPS port 443 is supported.');
  ensure(allowedHosts.map(x=>x.toLowerCase().trim()).includes(url.hostname.toLowerCase()),'Provider host is not allowlisted. Add the exact trusted hostname to PROVIDER_ALLOWED_HOSTS on the server.');
  ensure(!isIP(url.hostname)&&url.hostname.includes('.'),'Use an allowlisted public hostname.');
  return url;
}
