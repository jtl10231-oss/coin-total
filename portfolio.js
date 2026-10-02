(() => {
  'use strict';
  const P = Portfolio, M = P.MINUTE, $ = id => document.getElementById(id);
  const format = new Intl.NumberFormat('ko-KR', {maximumFractionDigits:0});
  const amount = n => Number.isFinite(n) ? format.format(Math.round(n)) : '—';
  const won = n => Number.isFinite(n) ? amount(n) + '원' : '—';
  const signed = n => Number.isFinite(n) ? (n > 0 ? '+' : n < 0 ? '−' : '') + won(Math.abs(n)) : '—';
  const pct = n => Number.isFinite(n) ? (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(2) + '%' : '—';
  const cls = n => Number.isFinite(n) && n !== 0 ? n > 0 ? 'up' : 'down' : '';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time = (t, date = false) => P.timestamp(t) ? new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', ...(date ? {month:'numeric',day:'numeric'} : {}), hour:'2-digit',minute:'2-digit',hour12:false}).format(t) : '시각 확인 불가';
  const age = t => {const m = Math.max(0,Math.floor((Date.now()-t)/M)); return m < 1 ? '방금' : m < 60 ? m+'분 전' : m < 1440 ? Math.floor(m/60)+'시간 전' : Math.floor(m/1440)+'일 전';};
  const rangeNames = {60:'1시간',360:'6시간',1440:'24시간',10080:'7일'};
  const names = {SOL:'솔라나',WLD:'월드코인'};
  const quotes = {}, history = new Map(), jobs = new Map();
  let range = 360, mode = 'total', selected = null, forecast = null, news = null;
  let socket = null, ping = null, reconnect = null, connectTimeout = null, retryDelay = 3000, connected = false;
  let historyUpdated = null, historyError = false, forecastError = false, newsError = false, chartFrame = null;
  if (!P.holdingsValid(coins)) {
    $('price-status').textContent = '보유 설정을 확인해 주세요';
    $('price-warning').hidden = false;
    $('price-warning').textContent = '보유 설정을 읽을 수 없어 평가액을 계산하지 않았어요.';
    return;
  }
  const holdings = coins.map(c => ({sym:c.sym, name:names[c.sym], qty:c.qty, buy:c.buy}));
  $('asset-list').innerHTML = holdings.map(c => `<details class="asset" id="asset-${c.sym}"><summary><img class="asset-icon" src="icons/${c.sym.toLowerCase()}.svg" alt="" width="48" height="48"><div><div class="asset-title">${c.name}<span class="asset-symbol">${c.sym}</span></div><div class="asset-price"><span id="price-${c.sym}">—</span><span id="daily-${c.sym}" class="asset-change">24시간 기록 대기</span></div></div><div class="asset-value"><div id="value-${c.sym}">—</div><div id="return-${c.sym}" class="asset-return">원금 대비 —</div></div><span class="asset-arrow" aria-hidden="true">›</span></summary><div class="asset-detail"><dl><dt>보유 수량</dt><dd>${c.qty.toLocaleString('ko-KR',{maximumFractionDigits:8})} ${c.sym}</dd></dl><dl><dt>평균 매입가</dt><dd>${won(c.buy)}</dd></dl><dl><dt>평가 비중</dt><dd id="weight-${c.sym}">—</dd></dl><dl><dt>원금 대비 손익</dt><dd id="profit-${c.sym}">—</dd></dl><dl><dt>UTC 시가 대비</dt><dd id="utc-${c.sym}">—</dd></dl><dl><dt>가격 기준 시각 · KST</dt><dd id="at-${c.sym}">—</dd></dl><p class="detail-note">현재 설정 수량 기준 · 최근 체결가 평가 · 수수료·세금 제외</p></div></details>`).join('');
  function changeText(id, text, n, base = '') {const e=$(id);e.textContent=text;e.className=[base,cls(n)].filter(Boolean).join(' ');}
  function ordered() {return [...history.values()].sort((a,b)=>a.t-b.t);}
  function renderValues() {
    const value=P.valuation(holdings,quotes), points=ordered();
    if(value) {
      $('total').textContent=amount(value.value);$('total').style.setProperty('--digits',Math.max(1,Math.min(1.45,amount(value.value).length/11)));
      changeText('profit',signed(value.profit),value.profit);
      changeText('return',pct(value.rate),value.rate,'return-pill');
      $('allocation').innerHTML=value.rows.map(c=>`<span class="${c.sym.toLowerCase()}" style="width:${c.weight.toFixed(4)}%"></span>`).join('');
      $('allocation-labels').innerHTML=value.rows.map(c=>`<span>${c.name}<b>${c.weight.toFixed(1)}%</b></span>`).join('');
      value.rows.forEach(c=>{
        $('price-'+c.sym).textContent=won(c.price);$('pulse-'+c.sym).textContent=won(c.price);
        $('value-'+c.sym).textContent=won(c.value);
        changeText('return-'+c.sym,'원금 대비 '+pct(c.rate),c.rate,'asset-return');
        changeText('profit-'+c.sym,signed(c.profit),c.profit);
        $('weight-'+c.sym).textContent=c.weight.toFixed(1)+'%';
        const q=quotes[c.sym], before=P.atOrBefore(points,q.at-1440*M);
        const daily=before?(q.price/before[c.sym]-1)*100:null;
        changeText('daily-'+c.sym,before?'24시간 '+pct(daily):'24시간 기록 없음',daily,'asset-change');changeText('pulse-rate-'+c.sym,before?'24시간 '+pct(daily):'기록 확인 중',daily);
        changeText('utc-'+c.sym,pct(q.utcRate),q.utcRate);
        $('at-'+c.sym).textContent=time(q.at,true);
      });
    }
    renderStatus(); scheduleChart();
  }
  function renderStatus() {
    const f=P.freshness(quotes), offline=!navigator.onLine;
    const labels={empty:offline?'오프라인 · 시세를 기다리는 중':'시세 연결 중',live:connected?'실시간 시세 수신':'마지막 수신 시세',history:'1분 기록 기준',stale:'가격 업데이트 지연'};
    $('price-status').textContent=(offline?'오프라인 · 마지막 자료':labels[f.kind])+(f.at?' · '+age(f.at):'');
    $('status-dot').className='status-dot '+(f.kind==='live'&&connected?'live':f.kind==='stale'||offline?'stale':'');
    $('quote-time').textContent=f.at?`코인원 KRW · SOL ${time(quotes.SOL.at)} / WLD ${time(quotes.WLD.at)} 기준 · KST`:'코인원 원화 마켓 · 최근 체결가';
    const warning=offline?'인터넷 연결이 끊겼어요. 마지막으로 받은 값이며, 연결되면 다시 확인해요.':f.kind==='stale'?'3분 이상 새 가격을 받지 못했어요. 표시 금액은 마지막 자료 기준이에요.':f.kind==='history'?'실시간 연결 전에는 1분 기록으로 평가해요. 최신 체결가와 차이가 날 수 있어요.':!connected&&f.at?'실시간 연결이 끊겨 다시 연결 중이에요. 마지막 수신값을 표시해요.':f.kind==='empty'&&historyError?'시세와 지난 기록을 아직 받지 못했어요. 다시 확인을 눌러 주세요.':'';
    $('price-warning').hidden=!warning; $('price-warning').textContent=warning;
    const recordOld=historyUpdated&&Date.now()-historyUpdated>8*M;
    $('history-status').textContent=historyUpdated?(historyError?'새 기록 확인 실패 · ':recordOld?'기록 지연 · ':'기록 ')+time(historyUpdated,true)+' 기준':'지난 기록을 '+(historyError?'불러오지 못했어요':'확인 중이에요');
    if(forecast)$('forecast-status').textContent=(forecastError?'새 계산 확인 실패 · ':Date.now()-forecast.updated>70*M?'계산 지연 · ':'')+age(forecast.updated)+' 계산';
    if(news)$('news-status').textContent=(newsError?'새 뉴스 확인 실패 · ':Date.now()-news.updated>10*M?'자료 지연 · ':'')+age(news.updated)+' 확인';
  }
  async function fetchData(file, fn, fail) {
    if(jobs.has(file))return jobs.get(file);
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),12000);
    const job=(async()=>{try {const r=await fetch('https://raw.githubusercontent.com/jtl10231-oss/coin-total/data/'+file+'.json?t='+Date.now(),{signal:controller.signal,cache:'no-store'});if(!r.ok)throw new Error('http');fn(await r.json());}catch{fail();}finally{clearTimeout(timer);jobs.delete(file);renderStatus();}})();
    jobs.set(file,job); return job;
  }
  function loadHistory() {return fetchData('history',h=>{
    const points=P.historyPoints(h);if(!points.length||!P.timestamp(h.updated)||h.updated>Date.now()+M)throw new Error('empty');
    const currentMinute=Math.floor(Date.now()/M)*M;
    points.forEach(p=>{if(p.t<currentMinute||!history.has(p.t))history.set(p.t,p);});
    const cut=Date.now()-10081*M;history.forEach((p,t)=>{if(t<cut)history.delete(t);});
    historyUpdated=h.updated;historyError=false;
    const last=points[points.length-1];
    holdings.forEach(c=>{const q=quotes[c.sym];if(!q||q.at<last.t)quotes[c.sym]={price:last[c.sym],at:last.t,source:'history',utcRate:null};});
    renderValues();
  },()=>{historyError=true;if(!history.size){$('chart-empty').textContent='지난 기록을 불러오지 못했어요';$('chart-tip').textContent='다시 확인하거나 실시간 기록을 기다려 주세요.';}});}
  function sentimentRow(name,o) {
    if(!o||!Number.isFinite(o.score)||o.score<0||o.score>100)throw new Error('sentiment');
    return `<div class="sentiment-row"><div class="sentiment-top"><span>${name}</span><span><b>${Math.round(o.score)}</b><small>/ 100 · ${esc(o.label)}</small></span></div><div class="sentiment-track"><i style="left:${o.score}%"></i></div><div class="sentiment-desc">${(Array.isArray(o.parts)?o.parts:[]).map(p=>esc(p.name)+' '+esc(p.raw)).join(' · ')}</div></div>`;
  }
  function loadForecast() {return fetchData('forecast',f=>{
    if(!P.timestamp(f.updated)||f.updated>Date.now()+M||!Array.isArray(f.forecast))throw new Error('forecast');
    const html=sentimentRow('코인 시장',f.market)+sentimentRow('솔라나',f.SOL?.sentiment)+sentimentRow('월드코인',f.WLD?.sentiment);
    if(![1,3,7,14].every(d=>f.forecast.some(x=>x.days===d&&['high','mid','low'].every(k=>P.scenario(x,k,holdings)))))throw new Error('scenario');
    // Keep only the public price scenarios needed by this screen. Never use holdKey/TOTAL.
    forecast={updated:f.updated,forecast:f.forecast.map(x=>({days:x.days,SOL:x.SOL,WLD:x.WLD}))};forecastError=false;
    $('sentiment').innerHTML=html;renderScenarios();
  },()=>{forecastError=true;if(!forecast){$('forecast-status').textContent='계산 자료 확인 실패';$('sentiment').innerHTML='<p class="empty-copy">계산 자료를 불러오지 못했어요. 다시 확인해 주세요.</p>';$('scenarios').innerHTML='<p class="empty-copy">가격 시나리오를 불러오지 못했어요.</p>';}});}
  function renderScenarios() {
    if(!forecast)return;
    const day=Number(document.querySelector('[data-days][aria-pressed="true"]').dataset.days), x=forecast.forecast.find(x=>x.days===day);
    $('scenarios').innerHTML='<div class="scenarios">'+[['상단','high',''],['중간','mid','middle'],['하단','low','']].map(([label,key,style])=>{
      const s=P.scenario(x,key,holdings);return `<div class="scenario ${style}"><h4>${day===14?'2주':day+'일'} 후 · ${label}</h4><div class="scenario-total">${won(s.value)}</div><div class="scenario-return ${cls(s.rate)}">원금 대비 ${pct(s.rate)}</div><div class="scenario-prices">SOL ${won(x.SOL[key])}<br>WLD ${won(x.WLD[key])}</div></div>`;
    }).join('')+'</div>';
  }
  function loadNews() {return fetchData('news',f=>{
    if(!P.timestamp(f.updated)||f.updated>Date.now()+M||!Array.isArray(f.SOL)||!Array.isArray(f.WLD))throw new Error('news');
    function item(n,latest=false) {const url=P.safeURL(n?.link);return url?`<a class="news-item${latest?' news-latest':''}" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span class="news-title">${esc(n.title)} <span aria-hidden="true">↗</span></span><span class="news-source">${esc(n.source)} · ${P.timestamp(n.date)?time(n.date,true)+' KST':'기사 시각 확인 불가'}${latest?' · 최신 일반 기사':''}</span></a>`:'';}
    $('news').innerHTML=holdings.map(c=>{const arr=f[c.sym].slice(0,3),important=arr.map(n=>item(n)).join('');return `<div class="news-group"><h4>${c.sym} / ${c.name}</h4>${important||'<p class="empty-copy">최근 48시간 동안 중요 뉴스가 없어요.</p>'+ (f[c.sym+'_latest']?item(f[c.sym+'_latest'],true):'')}</div>`;}).join('');
    news={updated:f.updated};newsError=false;
  },()=>{newsError=true;if(!news){$('news-status').textContent='뉴스 확인 실패';$('news').innerHTML='<p class="empty-copy">뉴스를 불러오지 못했어요. 다시 확인해 주세요.</p>';}});}
  function addLive() {
    if(holdings.some(c=>quotes[c.sym]?.source!=='live'))return;
    const stamps=holdings.map(c=>quotes[c.sym].at);
    if(Math.max(...stamps)-Math.min(...stamps)>3*M||Date.now()-Math.min(...stamps)>3*M)return;
    const t=Math.floor(Math.min(...stamps)/M)*M;
    history.set(t,{t,SOL:quotes.SOL.price,WLD:quotes.WLD.price});
    const cut=Date.now()-10081*M;history.forEach((p,k)=>{if(k<cut)history.delete(k);});
    // Cache public market prices only; never portfolio quantities, costs or amounts.
    if(Date.now()-lastSave>15000){lastSave=Date.now();try{localStorage.setItem('coin-journal.prices.v1',JSON.stringify(ordered().filter(p=>p.t>=Date.now()-1440*M)));}catch{}}
  }
  let lastSave=0;
  try {const cached=JSON.parse(localStorage.getItem('coin-journal.prices.v1')||'[]');if(Array.isArray(cached))cached.slice(-1441).forEach(p=>{if(P.timestamp(p.t)&&p.t>Date.now()-10081*M&&p.t<=Date.now()&&P.positive(p.SOL)&&P.positive(p.WLD))history.set(p.t,p);});}catch{}
  function connect() {
    clearTimeout(reconnect);clearTimeout(connectTimeout);clearInterval(ping);
    if(socket){socket.onclose=null;socket.close();}connected=false;
    if(!navigator.onLine){renderStatus();return;}
    const ws=socket=new WebSocket('wss://stream.coinone.co.kr');
    connectTimeout=setTimeout(()=>{if(ws===socket&&ws.readyState!==1)ws.close();},15000);
    ws.onopen=()=>{
      if(ws!==socket)return;clearTimeout(connectTimeout);connected=true;retryDelay=3000;
      holdings.forEach(c=>ws.send(JSON.stringify({request_type:'SUBSCRIBE',channel:'TICKER',topic:{quote_currency:'KRW',target_currency:c.sym}})));
      ping=setInterval(()=>{if(ws.readyState===1)ws.send(JSON.stringify({request_type:'PING'}));},60000);renderStatus();
    };
    ws.onmessage=e=>{if(ws!==socket)return;try{const q=P.quote(JSON.parse(e.data));if(!q||quotes[q.sym]?.at>q.at)return;quotes[q.sym]=q;addLive();renderValues();}catch{}};
    ws.onerror=()=>{if(ws===socket)ws.close();};
    ws.onclose=()=>{if(ws!==socket)return;clearTimeout(connectTimeout);clearInterval(ping);connected=false;renderStatus();reconnect=setTimeout(connect,retryDelay);retryDelay=Math.min(30000,retryDelay*1.5);};
  }
  function scheduleChart(){if(chartFrame!==null)return;chartFrame=requestAnimationFrame(()=>{chartFrame=null;drawChart();});}
  function drawChart() {
    const cv=$('chart'), W=cv.clientWidth,H=cv.clientHeight,dpr=Math.min(devicePixelRatio||1,3);
    if(!W||!H)return;
    cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);const g=cv.getContext('2d');g.scale(dpr,dpr);g.clearRect(0,0,W,H);
    const now=Date.now(), s=P.rangeSummary(ordered(),holdings,now-range*M,now), pts=s.points;
    $('period-label').textContent=rangeNames[range]+' 기록 변화';
    changeText('period-change',signed(s.change),s.change);changeText('period-rate',pct(s.rate),s.rate);
    const scrub=$('chart-scrub');scrub.disabled=pts.length<2;scrub.max=Math.max(0,pts.length-1);
    $('chart-empty').hidden=pts.length>=2;
    if(pts.length<2){$('chart-tip').textContent='선택한 기간의 기록이 부족해요.';$('chart-empty').textContent=historyError?'지난 기록을 불러오지 못했어요':'선택한 기간의 기록이 아직 부족해요';$('chart-summary').textContent='차트 기록이 부족해요.';$('contributions').textContent='선택한 기간의 변화 기록이 부족해요.';return;}
    const contributions=s.contributions, max=Math.max(...contributions.map(c=>Math.abs(c.change)),1);
    $('contributions').innerHTML=contributions.map(c=>`<div class="contribution-row"><span>${names[c.sym]}</span><div class="contribution-track"><i class="${cls(c.change)}" style="width:${Math.abs(c.change)/max*100}%"></i></div><b class="${cls(c.change)}">${signed(c.change)}</b></div>`).join('');
    const L=2,R=W-52,T=15,B=H-27, first=pts[0],last=pts[pts.length-1];
    const chartValues=mode==='total'?[pts.map(p=>P.pointValue(p,holdings))]:holdings.map(c=>pts.map(p=>(p[c.sym]/first[c.sym]-1)*100));
    let lo=Math.min(...chartValues.flat()),hi=Math.max(...chartValues.flat());
    if(mode==='compare'){lo=Math.min(lo,0);hi=Math.max(hi,0);}
    const padding=(hi-lo)*.15||Math.max(Math.abs(hi)*.005,mode==='compare'?.1:1);lo-=padding;hi+=padding;
    const X=t=>L+(R-L)*(t-first.t)/(last.t-first.t),Y=v=>B-(B-T)*(v-lo)/(hi-lo);
    g.font='10px -apple-system, sans-serif';g.fillStyle='#626d65';g.strokeStyle='#dcded3';g.lineWidth=.6;
    for(let i=0;i<4;i++){const v=lo+(hi-lo)*i/3,y=Y(v);g.beginPath();g.moveTo(L,y);g.lineTo(R,y);g.stroke();g.fillText(mode==='compare'?v.toFixed(1)+'%':v>=10000?amount(v/10000)+'만':amount(v),R+7,y+3);}
    g.fillText(time(first.t,range>1440),L,H-6);const end=time(last.t,range>1440);g.fillText(end,R-g.measureText(end).width,H-6);
    const colors=['#163d35','#9b8664'];
    const gaps=pts.map((p,i)=>i&&p.t-pts[i-1].t>3*M?1:0);
    for(let i=1;i<gaps.length;i++)gaps[i]+=gaps[i-1];
    chartValues.forEach((values,j)=>{
      // Preserve extrema when reducing long series for small screens.
      const stride=Math.max(1,Math.floor(pts.length/(Math.max(W,1)*2))), indexes=[];
      for(let i=0;i<pts.length;i+=stride){let min=i,max=i;for(let k=i;k<Math.min(i+stride,pts.length);k++){if(values[k]<values[min])min=k;if(values[k]>values[max])max=k;}indexes.push(...[...new Set([i,min,max,Math.min(i+stride-1,pts.length-1)])].sort((a,b)=>a-b));}
      g.beginPath();indexes.forEach((i,k)=>k&&gaps[i]===gaps[indexes[k-1]]?g.lineTo(X(pts[i].t),Y(values[i])):g.moveTo(X(pts[i].t),Y(values[i])));
      if(mode==='total'&&gaps[gaps.length-1]===0){g.lineTo(R,B);g.lineTo(L,B);g.closePath();const fill=g.createLinearGradient(0,T,0,B);fill.addColorStop(0,'#163d3520');fill.addColorStop(1,'#163d3500');g.fillStyle=fill;g.fill();g.beginPath();indexes.forEach((i,k)=>k&&gaps[i]===gaps[indexes[k-1]]?g.lineTo(X(pts[i].t),Y(values[i])):g.moveTo(X(pts[i].t),Y(values[i])));}
      g.strokeStyle=colors[j];g.lineWidth=j===0?1.8:1.5;g.stroke();
    });
    const index=selected===null?pts.length-1:Math.min(pts.length-1,Math.max(0,selected));scrub.value=index;
    const p=pts[index];
    if(selected!==null){g.strokeStyle='#a4ada0';g.lineWidth=.8;g.setLineDash([3,4]);g.beginPath();g.moveTo(X(p.t),T);g.lineTo(X(p.t),B);g.stroke();g.setLineDash([]);}
    chartValues.forEach((values,j)=>{g.fillStyle=colors[j];g.beginPath();g.arc(X(p.t),Y(values[index]),3,0,Math.PI*2);g.fill();});
    $('chart-tip').innerHTML=mode==='total'?`${time(p.t,true)} KST <b>${won(P.pointValue(p,holdings))}</b>`:`${time(p.t,true)} KST <b>SOL ${pct(chartValues[0][index])} · WLD ${pct(chartValues[1][index])}</b>`;
    $('chart-legend').innerHTML=mode==='total'?'<i></i> 평가액':'<i></i> SOL <i class="wld"></i> WLD';
    $('chart-summary').textContent=`${rangeNames[range]} 중 확보한 기록 ${time(first.t,true)}부터 ${time(last.t,true)}까지. 평가액 변화 ${signed(s.change)}, ${pct(s.rate)}. ${mode==='compare'?'코인 비교는 첫 기록의 가격 대비 변화율이에요.':''}`;
  }
  document.querySelectorAll('[data-range]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-range]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));range=Number(b.dataset.range);selected=null;scheduleChart();}));
  document.querySelectorAll('[data-chart]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-chart]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));mode=b.dataset.chart;selected=null;$('chart').setAttribute('aria-label',mode==='total'?'평가액 변화 차트':'코인별 첫 기록 대비 가격 변화율 차트');scheduleChart();}));
  document.querySelectorAll('[data-days]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-days]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderScenarios();}));
  $('chart-scrub').addEventListener('input',e=>{selected=Number(e.target.value);scheduleChart();});
  $('chart').addEventListener('pointermove',e=>{const b=e.target.getBoundingClientRect(),n=ordered().filter(p=>p.t>=Date.now()-range*M).length;selected=Math.round(Math.min(1,Math.max(0,(e.clientX-b.left-2)/(b.width-54)))*(n-1));scheduleChart();});
  ['pointerleave','pointerup','pointercancel'].forEach(event=>$('chart').addEventListener(event,()=>{selected=null;scheduleChart();}));
  document.querySelectorAll('[data-asset-jump]').forEach(a=>a.addEventListener('click',()=>{$('asset-'+a.dataset.assetJump).open=true;}));
  $('retry').addEventListener('click',async()=>{const b=$('retry');b.disabled=true;b.textContent='확인 중…';connect();await Promise.all([loadHistory(),loadForecast(),loadNews()]);b.disabled=false;b.textContent='다시 확인 ↻';});
  window.addEventListener('resize',scheduleChart);window.addEventListener('online',()=>{connect();loadHistory();loadForecast();loadNews();});window.addEventListener('offline',renderStatus);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderStatus();if(!socket||socket.readyState>1)connect();scheduleChart();}});
  const navLinks=[...document.querySelectorAll('.bottomnav a')];
  function updateNav(){const at=window.scrollY+window.innerHeight*.3;let id='overview';['assets','context'].forEach(s=>{if($(s).offsetTop<=at)id=s;});navLinks.forEach(a=>{if(a.hash==='#'+id)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});}
  window.addEventListener('scroll',updateNav,{passive:true});
  setInterval(renderStatus,15000);setInterval(loadHistory,5*M);setInterval(loadForecast,10*M);setInterval(loadNews,3*M);
  if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
  renderValues();loadHistory();loadForecast();loadNews();connect();
})();
