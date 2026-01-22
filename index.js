// --- SPA Router ---
(function(){
    const routes = {
        home: { title:'Welcome', html:`<h2>Welcome</h2><p>Use the menu above to switch sections.</p>` },
        contact: { title:'Contact', html:`<h2>Contact</h2><ul><li>Email: <a href="mailto:marcus.margarites@hotmail.com">marcus.margarites@hotmail.com</a></li><li>LinkedIn: <a href="https://www.linkedin.com/in/marcusmargarites/">linkedin.com/in/marcusmargarites/</a></li></ul>` },
        resume: { title:'Resume', html:`<h2>Resume</h2><p>I am a systems engineer with more than 35 years of experience, working with architecture, team leadership, training, systems analysis, and software development.</p><p><a href="resume/resume.pdf">Click to view my resume.</a></p>` },
        ai: { title:'AI', html:`<h2>AI</h2><p>Soon!</p>` }
    };
    const panel = document.getElementById('contentPanel');
    function setActive(route){
        const def = routes[route] || routes.home;
        document.title = `mvfm's website — ${def.title}`;
        panel.innerHTML = def.html;
        requestAnimationFrame(()=>panel.classList.add('show'));
        document.querySelectorAll('.menu button').forEach(btn=>{
            btn.setAttribute('aria-current', btn.dataset.route===route ? 'page' : 'false');
        });
    }
    document.querySelectorAll('.menu button').forEach(btn=>{
        btn.addEventListener('click',()=>{ panel.classList.remove('show'); setTimeout(()=>setActive(btn.dataset.route),120); });
    });
    setActive('home');
})();

// --- Game of Life + Seven-seg stats ---
(function(){
    const canvas=document.getElementById('golCanvas');
    const ctx=canvas.getContext('2d',{alpha:true});
    // Double-buffer to reduce flicker/tearing
    const off=document.createElement('canvas');
    const offCtx=off.getContext('2d',{alpha:true});
    ctx.imageSmoothingEnabled = true;
    offCtx.imageSmoothingEnabled = true;

    // Stats elements
    const genDigits=document.getElementById('genDigits');
    const aliveDigits=document.getElementById('aliveDigits');
    const totalDigits=document.getElementById('totalDigits');
    const occDigits=document.getElementById('occDigits');

    // Tunables
    const CELL=8;              // px per cell
    const STEP_MS=1200;        // slightly faster cadence
    const CELL_ALPHA=0.7;      // per-cell brightness (canvas also dimmed)

    // Seven-seg map
    const DIGIT={'0':[1,1,1,1,1,1,0],'1':[0,1,1,0,0,0,0],'2':[1,1,0,1,1,0,1],'3':[1,1,1,1,0,0,1],'4':[0,1,1,0,0,1,1],'5':[1,0,1,1,0,1,1],'6':[1,0,1,1,1,1,1],'7':[1,1,1,0,0,0,0],'8':[1,1,1,1,1,1,1],'9':[1,1,1,1,0,1,1]};

    function createDigit(){
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('viewBox','0 0 56 110');
        svg.setAttribute('width','7ch');
        svg.setAttribute('height','1.7rem');
        const r=3; const segs=[];
        function rect(x,y,w,h){ const el=document.createElementNS('http://www.w3.org/2000/svg','rect'); el.setAttribute('x',x); el.setAttribute('y',y); el.setAttribute('width',w); el.setAttribute('height',h); el.setAttribute('rx',r); el.setAttribute('ry',r); el.setAttribute('class','seg'); return el; }
        segs.push(rect(8,2,40,8)); segs.push(rect(48,10,8,40)); segs.push(rect(48,58,8,40)); segs.push(rect(8,98,40,8)); segs.push(rect(0,58,8,40)); segs.push(rect(0,10,8,40)); segs.push(rect(8,50,40,8));
        const dp=document.createElementNS('http://www.w3.org/2000/svg','circle'); dp.setAttribute('cx','54'); dp.setAttribute('cy','106'); dp.setAttribute('r','3'); dp.setAttribute('class','seg');
        svg.append(...segs); svg.append(dp); svg.segs=segs; svg.dp=dp; return svg;
    }
    function setDigit(svg,ch){ if(ch==='.'){ svg.segs.forEach(s=>s.setAttribute('class','seg')); svg.dp.setAttribute('class','seg on'); return;} const map=DIGIT[ch]||[0,0,0,0,0,0,0]; for(let i=0;i<7;i++) svg.segs[i].setAttribute('class', map[i]?'seg on':'seg'); svg.dp.setAttribute('class','seg'); }
    function render(container,text){ while(container.children.length<text.length) container.appendChild(createDigit()); while(container.children.length>text.length) container.removeChild(container.lastChild); for(let i=0;i<text.length;i++) setDigit(container.children[i], text[i]); }

    function pad8(n){ return Math.floor(Math.max(0,n)).toString().padStart(8,'0'); }
    function occFmt(alive,total){ const pct=total>0?(alive/total*100):0; const c=Math.min(100,Math.max(0,pct)); const [i,d]=c.toFixed(3).split('.'); return i.padStart(3,'0')+'.'+d; }

    // Grid state
    let cols,rows,from,to,buffer; let generation=0; let totalCells=0; let lastStep=0; let raf;

    function resize(){
        const dpr=Math.max(1,Math.min(window.devicePixelRatio||1,2));
        const w=canvas.clientWidth, h=canvas.clientHeight;
        canvas.width=Math.floor(w*dpr);
        canvas.height=Math.floor(h*dpr);
        off.width = canvas.width;
        off.height = canvas.height;
        ctx.setTransform(dpr,0,0,dpr,0,0);
        offCtx.setTransform(dpr,0,0,dpr,0,0);
        init();
    }
    function init(){ cols=Math.ceil(canvas.clientWidth/CELL); rows=Math.ceil(canvas.clientHeight/CELL); from=new Uint8Array(cols*rows); to=new Uint8Array(cols*rows); buffer=new Uint8Array(cols*rows); for(let i=0;i<from.length;i++) from[i]=Math.random()<0.10?1:0; stepInto(from,to); lastStep=performance.now(); generation=0; totalCells=cols*rows; updateStats(countAlive(from)); }
    function idx(x,y){ return y*cols+x; }
    function stepInto(src,dst){ for(let y=0;y<rows;y++){ for(let x=0;x<cols;x++){ let n=0; for(let j=-1;j<=1;j++){ for(let i=-1;i<=1;i++){ if(i||j){ const xx=(x+i+cols)%cols, yy=(y+j+rows)%rows; n+=src[idx(xx,yy)]; }}} const alive=src[idx(x,y)]===1; dst[idx(x,y)]=(alive&&(n===2||n===3))||(!alive&&n===3)?1:0; }}}
    function ease(t){ t=Math.max(0,Math.min(1,t)); return t*t*(3-2*t); }
    function draw(progress){
        const t=ease(progress);
        // draw to offscreen first (reduces visible partial repaints)
        offCtx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);
        offCtx.fillStyle='#9fb4e3';
        for(let y=0;y<rows;y++){
            for(let x=0;x<cols;x++){
                const i=idx(x,y);
                const a=(from[i]*(1-t)+to[i]*t)*CELL_ALPHA;
                if(a<=0) continue;
                offCtx.globalAlpha=a;
                offCtx.fillRect(x*CELL,y*CELL,CELL-1,CELL-1);
            }
        }
        offCtx.globalAlpha=1;
        // blit
        ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);
        ctx.drawImage(off, 0, 0, canvas.clientWidth, canvas.clientHeight);
    }

    function countAlive(arr){ let c=0; for(let i=0;i<arr.length;i++) c+=arr[i]; return c; }
    function updateStats(alive){ render(genDigits,pad8(generation)); render(aliveDigits,pad8(alive)); render(totalDigits,pad8(totalCells)); render(occDigits,occFmt(alive,totalCells)); }

    function loop(now){ const progress=(now-lastStep)/STEP_MS; if(progress>=1){ from.set(to); stepInto(from,buffer); const aliveNext=countAlive(buffer); const tmp=to; to=buffer; buffer=tmp; generation++; lastStep=now; updateStats(aliveNext); } draw(Math.min(progress,1)); raf=requestAnimationFrame(loop); }

    const ro=new ResizeObserver(()=>resize()); ro.observe(canvas);
    resize(); loop(performance.now());
    addEventListener('beforeunload',()=>cancelAnimationFrame(raf));
})();
