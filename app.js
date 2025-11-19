let registros=[];let filtrados=[];let novos=[];let ultimaLista=[];

// Leitura CSV
const csvFile=document.getElementById("csvFile");
csvFile.addEventListener("change",()=>{
 const f=csvFile.files[0]; if(!f) return;
 const r=new FileReader();
 r.onload=e=>{registros=parseCSV(e.target.result); alert("CSV carregado!")};
 r.readAsText(f,"UTF-8");
});

function parseCSV(txt){
 let l=txt.trim().split(/\r?\n/);
 return l.slice(1).map(x=>{let c=x.split(";"); return {cns:c[0],nome:c[1],nasc:c[2],data:c[3],exame:c[4]};});
}

function normalizar(n){return n.toLowerCase().replace(/(?:^|\s)\S/g,m=>m.toUpperCase());}

// Aplicar filtros
const btnAplicar=document.getElementById("btnAplicar");
btnAplicar.onclick=()=>processar();

function processar(){
 let ini=document.getElementById("dataInicio").value;
 let fim=document.getElementById("dataFim").value;
 if(!ini||!fim){alert("Selecione o intervalo de datas.");return;}
 let d1=new Date(ini), d2=new Date(fim);

 let mapa={};
 registros.forEach(r=>{
   let dt=new Date(r.data.split("/").reverse().join("-"));
   if(dt>=d1 && dt<=d2){
     if(!mapa[r.cns]) mapa[r.cns]={cns:r.cns,nome:r.nome,nasc:r.nasc,exames:0,dias:{}};
     mapa[r.cns].exames++;
     mapa[r.cns].dias[r.data]=true;
   }
 });
 filtrados=Object.values(mapa).map(x=>{
   x.nome=normalizar(x.nome);
   x.presencas=Object.keys(x.dias).length;
   return x;
 });
 detectarNovos();
 renderTabela();
 renderGrafico();
 atualizarArmazenamento();
}

// Renderizar tabela
function renderTabela(){
 let tb=document.querySelector("#tabelaPacientes tbody");
 tb.innerHTML="";
 filtrados.forEach(r=>{
   let tr=document.createElement("tr");
   tr.innerHTML=`<td>${r.cns}</td><td>${r.nome}</td><td>${r.nasc}</td><td>${r.exames}</td><td>${r.presencas}</td>`;
   tr.onclick=()=>mostrarExames(r.cns);
   tb.appendChild(tr);
 });
}

// Pesquisar
const campoPesquisa=document.getElementById("pesquisa");
campoPesquisa.oninput=()=>{
 let q=campoPesquisa.value.toLowerCase();
 filtrados=filtrados.filter(x=>x.nome.toLowerCase().includes(q));
 renderTabela();
};

// Ordenação
const ths=document.querySelectorAll("#tabelaPacientes th");
ths.forEach(th=>{
 th.addEventListener("click",()=>{
   let col=th.dataset.col;
   filtrados.sort((a,b)=> a[col]>b[col] ? 1 : -1);
   renderTabela();
 });
});

// Modal de exames
function mostrarExames(cns){
 let lista=registros.filter(x=>x.cns===cns);
 let m=document.getElementById("modal");
 let c=document.getElementById("modalContent");
 let html=`<h2>Exames</h2>`;
 lista.forEach(x=> html+=`<p><b>${x.exame}</b> — ${x.data}</p>`);
 c.innerHTML=html;
 m.style.display="flex";
}
document.getElementById("modal").onclick=()=>document.getElementById("modal").style.display="none";

// Novos registros
function detectarNovos(){
 let last=JSON.parse(localStorage.getItem("ultimaLista")||"[]");
 let antigos=new Set(last.map(x=>x.cns));
 novos=filtrados.filter(x=>!antigos.has(x.cns));
 localStorage.setItem("ultimaLista",JSON.stringify(filtrados));
 document.getElementById("listaNovos").innerHTML=novos.map(x=>x.nome).join("<br>");
}

document.getElementById("btnCopiarNovos").onclick=()=>{
 let txt=novos.map(x=>x.nome).join("\n");
 navigator.clipboard.writeText(txt);
 alert("Copiado!");
};

// Armazenamento
function atualizarArmazenamento(){
 let usado=JSON.stringify(localStorage).length;
 let max=5*1024*1024;
 let pct=((usado/max)*100).toFixed(1);
 document.getElementById("armazenamentoInfo").innerText=`Uso: ${pct}%`;
}

// Gráfico — implementado sem libs externas
function renderGrafico(){
 let canvas=document.getElementById("grafico");
 let ctx=canvas.getContext("2d");
 ctx.clearRect(0,0,canvas.width,canvas.height);
 let dias={}; filtrados.forEach(x=>{dias[x.cns]=(dias[x.cns]||0)+x.exames});
 let valores=Object.values(dias);
 let labels=Object.keys(dias);
 let max=Math.max(...valores,1);
 let w=canvas.width/(labels.length||1);
 ctx.fillStyle="#005dff";
 valores.forEach((v,i)=>{
   let h=(v/max)*(canvas.height-20);
   ctx.fillRect(i*w+10,canvas.height-h, w-20, h);
   ctx.fillText(labels[i].slice(-4), i*w+10, canvas.height-5);
 });
}
