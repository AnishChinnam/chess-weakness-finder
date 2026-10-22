export const BOARD_THEMES={green:{name:'Club green',light:'#eeeed2',dark:'#769656'},walnut:{name:'Walnut',light:'#f0d9b5',dark:'#b58863'},ocean:{name:'Ocean',light:'#deeaf2',dark:'#6592ad'},slate:{name:'Slate',light:'#d9dde2',dark:'#6c7684'},lavender:{name:'Lavender',light:'#ede3f4',dark:'#9873ac'},tournament:{name:'Tournament',light:'#ffffff',dark:'#46796a'}};
export const LABELS={Brilliant:{symbol:'!!',color:'#26c2ca'},Great:{symbol:'!',color:'#6aa9ef'},Best:{symbol:'★',color:'#89b64b'},Excellent:{symbol:'✓',color:'#a5bf77'},Good:{symbol:'·',color:'#9cafa0'},Inaccuracy:{symbol:'?!',color:'#e5b545'},Mistake:{symbol:'?',color:'#e58c39'},Blunder:{symbol:'??',color:'#d75a56'}};
export const DEFAULT_APPEARANCE={board:'green',pieces:'classic',surface:'charcoal',coordinates:true,badges:true,arrows:true,highlights:true};
export function normalizeAppearance(value={}){
  const result={...DEFAULT_APPEARANCE};
  if(BOARD_THEMES[value.board])result.board=value.board;
  if(['classic','modern','outline'].includes(value.pieces))result.pieces=value.pieces;
  if(['charcoal','midnight','light'].includes(value.surface))result.surface=value.surface;
  for(const key of ['coordinates','badges','arrows','highlights'])if(typeof value[key]==='boolean')result[key]=value[key];
  return result;
}
export function loadAppearance(storage){try{return normalizeAppearance(JSON.parse(storage.getItem('cwf-appearance-v1')||'{}'));}catch{return {...DEFAULT_APPEARANCE};}}
export function saveAppearance(storage,value){try{storage.setItem('cwf-appearance-v1',JSON.stringify(normalizeAppearance(value)));return true;}catch{return false;}}
const GLYPH={p:'♟',n:'♞',b:'♝',r:'♜',q:'♛',k:'♚'};
const SHAPES={p:'M14 30h12l-2-5-2-5a6 6 0 1 0-4 0l-2 5z M12 34h16v-4H12z',r:'M12 10v8l3 3-1 9h12l-1-9 3-3v-8h-4v5h-3v-5h-3v5h-3v-5z M11 34h18v-4H11z',n:'M12 30l2-9-4-1 5-9 8-4 1 5 6 7-4 11z M11 34h18v-4H11z M19 15h1',b:'M13 30l3-8q-8-6 4-16 12 10 4 16l3 8z M20 11l-3 7 M11 34h18v-4H11z',q:'M12 30l-3-16 8 6 3-12 3 12 8-6-3 16z M10 34h20v-4H10z',k:'M17 7h6 M20 4v9 M13 30l2-9q-9-9-2-11l7 4 7-4q7 2-2 11l2 9z M11 34h18v-4H11z'};
function point(square,whiteBottom){const file=square.charCodeAt(0)-97,rank=Number(square[1])-1;return {x:(whiteBottom?file:7-file)*40,y:(whiteBottom?7-rank:rank)*40};}
let serial=0;
export function reviewBoard(fen,{appearance=DEFAULT_APPEARANCE,whiteBottom=true,move=null,selected=null,legal=[],arrows=[],before=false}={}){
  appearance=normalizeAppearance(appearance);const theme=BOARD_THEMES[appearance.board],id='review-board-'+(++serial),badge=LABELS[move?.label];
  let squares='',pieces='',overlays='',hitboxes='',annotations='';
  for(let rank=0;rank<8;rank++)for(let file=0;file<8;file++){
    const square=String.fromCharCode(97+file)+(rank+1),p=point(square,whiteBottom),light=(file+rank)%2===1;
    squares+=`<rect x="${p.x}" y="${p.y}" width="40" height="40" fill="${light?theme.light:theme.dark}"/>`;
    if(appearance.highlights&&move&&[move.from,move.to].includes(square))overlays+=`<rect x="${p.x}" y="${p.y}" width="40" height="40" fill="${badge?.color||'#e5d44b'}" opacity=".42"/>`;
    if(selected===square)overlays+=`<rect x="${p.x+1}" y="${p.y+1}" width="38" height="38" fill="#f5da54" fill-opacity=".45" stroke="#f5da54" stroke-width="2"/>`;
    if(legal.includes(square))annotations+=`<circle cx="${p.x+20}" cy="${p.y+20}" r="5" fill="#111" opacity=".28"/>`;
    if(appearance.coordinates&&p.x===0)annotations+=`<text x="${p.x+3}" y="${p.y+10}" fill="${light?theme.dark:theme.light}" font-size="8" font-weight="700">${rank+1}</text>`;
    if(appearance.coordinates&&p.y===280)annotations+=`<text x="${p.x+32}" y="315" fill="${light?theme.dark:theme.light}" font-size="8" font-weight="700">${String.fromCharCode(97+file)}</text>`;
    hitboxes+=`<rect data-square="${square}" x="${p.x}" y="${p.y}" width="40" height="40" fill="transparent"/>`;
  }
  fen.split(' ')[0].split('/').forEach((row,r)=>{let file=0;for(const ch of row){if(/\d/.test(ch)){file+=Number(ch);continue;}const square=String.fromCharCode(97+file)+(8-r),p=point(square,whiteBottom),white=ch===ch.toUpperCase(),fill=white?'#fffaf0':'#26313a',stroke=white?'#39434b':'#101820';
    if(appearance.pieces==='classic')pieces+=`<text x="${p.x+20}" y="${p.y+32}" text-anchor="middle" font-family="Arial Unicode MS,Apple Symbols,DejaVu Sans,serif" font-size="37" fill="${fill}" stroke="${stroke}" stroke-width=".65" paint-order="stroke">${GLYPH[ch.toLowerCase()]}</text>`;
    else pieces+=`<g transform="translate(${p.x},${p.y})"><path d="${SHAPES[ch.toLowerCase()]}" fill="${appearance.pieces==='outline'?(white?'#fffaf0':'#27323d'):fill}" stroke="${appearance.pieces==='outline'?(white?'#29323b':'#f1e8d7'):stroke}" stroke-width="${appearance.pieces==='outline'?1.6:1.1}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
    file++;}});
  let defs='',lines='';
  if(appearance.arrows)arrows.forEach((arrow,i)=>{if(!/^[a-h][1-8]$/.test(arrow.from)||!/^[a-h][1-8]$/.test(arrow.to))return;const a=point(arrow.from,whiteBottom),b=point(arrow.to,whiteBottom);defs+=`<marker id="${id}-${i}" markerWidth="3" markerHeight="3" refX="2.3" refY="1.5" orient="auto"><path d="M0 0L3 1.5 0 3z" fill="${arrow.color}"/></marker>`;lines+=`<line x1="${a.x+20}" y1="${a.y+20}" x2="${b.x+20}" y2="${b.y+20}" stroke="${arrow.color}" stroke-width="5" stroke-linecap="round" opacity=".78" marker-end="url(#${id}-${i})"/>`;});
  if(appearance.badges&&move&&badge&&!before){const p=point(move.to,whiteBottom),x=Math.min(307,p.x+34),y=Math.max(13,p.y+7);annotations+=`<g pointer-events="none" data-move-badge="${move.label}"><title>${move.label}</title><circle cx="${x}" cy="${y}" r="12" fill="${badge.color}" stroke="#fff" stroke-width="1.3"/><text x="${x}" y="${y+4}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${badge.symbol.length>1?11:15}" font-weight="800" fill="#fff">${badge.symbol}</text></g>`;}
  return `<svg viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Chess board${move?', '+move.label+' '+move.san:''}"><defs>${defs}</defs>${squares}${overlays}${pieces}${lines}${annotations}${hitboxes}</svg>`;
}
