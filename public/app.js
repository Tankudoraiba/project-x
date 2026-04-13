const drop = document.getElementById('drop');
const picker = document.getElementById('filepicker');
const filesDiv = document.getElementById('files');
let items = [];

function render() {
  filesDiv.innerHTML = '';
  items.forEach((it, idx) => {
    const div = document.createElement('div');
    div.className = 'file';
    div.innerHTML = `
      <strong>${it.name}</strong><br>
      Format: <select data-idx="${idx}" class="format"><option>png</option><option>jpg</option><option>webp</option><option>heic</option></select>
      Width: <input data-idx="${idx}" class="width" size="4" />
      Height: <input data-idx="${idx}" class="height" size="4" />
      Crop: <input data-idx="${idx}" class="crop" placeholder='e.g. 10,10,100,100 or gravity:north' />
    `;
    filesDiv.appendChild(div);
  });
}

function handleFiles(files) {
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  fetch('/api/upload', { method: 'POST', body: form }).then(r=>r.json()).then(list=>{
    list.forEach(l=>items.push({ name: l.saved }));
    render();
  });
}

drop.addEventListener('drop', (e)=>{e.preventDefault(); handleFiles(e.dataTransfer.files)});
drop.addEventListener('dragover', (e)=>{e.preventDefault()});
picker.addEventListener('change', (e)=>handleFiles(e.target.files));

document.getElementById('process').addEventListener('click', async ()=>{
  const tasks = items.map((it, idx)=>{
    const format = document.querySelector(`.format[data-idx='${idx}']`).value;
    const width = parseInt(document.querySelector(`.width[data-idx='${idx}']`).value) || null;
    const height = parseInt(document.querySelector(`.height[data-idx='${idx}']`).value) || null;
    const cropVal = document.querySelector(`.crop[data-idx='${idx}']`).value || '';
    let crop = null;
    if (cropVal.startsWith('gravity:')) { const g = cropVal.split(':')[1]; crop = { width, height, gravity: g }; }
    else if (cropVal.includes(',')) { const p = cropVal.split(',').map(Number); crop = { left: p[0], top: p[1], width: p[2], height: p[3] }; }
    return { name: it.name, action: 'convert', toFormat: format, width, height, crop };
  });
  const res = await fetch('/api/process', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ tasks }) });
  const j = await res.json();
  alert('Created: ' + j.outputs.join(', '));
});
