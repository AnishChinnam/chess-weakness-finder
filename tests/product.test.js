import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trainingPlan,printablePlan,renderCommerce,safeUrl,saveHistory,readHistory,clearHistory} from '../static/product.js';
test('practice plans adapt to the top theme and time trouble, including a clean report',()=>{
  const plan=trainingPlan({weaknesses:[{key:'hung'},{key:'opening'}],time_trouble:{pct:60}});
  assert.equal(plan.length,7);assert.equal(plan[1].title,'Board vision');assert.equal(plan[3].title,'Opening decisions');assert.match(plan[5].task,/clock/);
  assert.equal(trainingPlan({weaknesses:[]})[1].title,'Forcing moves');
});
test('commerce stays hidden without real destinations and rejects executable URLs',()=>{
  assert.equal(renderCommerce({}),'');
  assert.equal(renderCommerce({tipUrl:'javascript:alert(1)',shop:{url:'http://example.com'}}),'');
  assert.equal(safeUrl('data:text/html,hi'),'');
  const html=renderCommerce({tipUrl:'https://ko-fi.com/example',shop:{url:'https://ko-fi.com/s/example',label:'Journal $3'},sponsor:{url:'https://example.com',name:'<script>',description:'Test'}});
  assert.match(html,/Journal \$3/);assert.match(html,/SPONSORED/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});
test('saved history survives malformed/unavailable storage and caps at five',()=>{
  let value='broken';const storage={getItem:()=>value,setItem:(key,v)=>{value=v;},removeItem:()=>{value=null;}};
  assert.deepEqual(readHistory(storage),[]);
  for(let i=0;i<7;i++)saveHistory(storage,{username:'x'+i,site:'lichess',timeControl:'both',numGames:5},{avg_mistakes:i,games_analyzed:5},i);
  assert.equal(readHistory(storage).length,5);assert.equal(readHistory(storage)[0].username,'x6');
  clearHistory(storage);assert.deepEqual(readHistory(storage),[]);
  assert.equal(saveHistory({getItem:()=>null,setItem:()=>{throw Error('quota');}},{},{},0),false);
});
test('downloaded plan escapes player input and clearly labels demo results',()=>{
  const html=printablePlan({username:'<img src=x onerror=alert(1)>',site:'Lichess',games_analyzed:5,weaknesses:[],demo:true});
  assert.doesNotMatch(html,/<img/);assert.match(html,/Illustrative sample/);assert.match(html,/Day 7/);
});
