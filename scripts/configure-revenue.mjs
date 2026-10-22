import fs from 'node:fs/promises';
import {safeUrl} from '../static/product.js';
const args=process.argv.slice(2), allowed=new Set(['tip','shop']);
if(args.length!==2 || !allowed.has(args[0]) || !safeUrl(args[1])){
  console.error('Usage: node scripts/configure-revenue.mjs tip|shop https://your-real-payment-link');process.exit(1);
}
const config=new URL('../static/config.js',import.meta.url);
let text=await fs.readFile(config,'utf8');
if(args[0]==='tip')text=text.replace(/tipUrl: "[^"]*"/,`tipUrl: ${JSON.stringify(safeUrl(args[1]))}`);
else text=text.replace(/shop: \{ url: "[^"]*"/,`shop: { url: ${JSON.stringify(safeUrl(args[1]))}`);
await fs.writeFile(config,text);
console.log(`${args[0]} link saved. Reload the local app, then publish the updated configuration.`);
