const drop = document.getElementById('drop');
const picker = document.getElementById('filepicker');
const filesDiv = document.getElementById('files');
let items = [];

const defaultPreserveCheckbox = document.getElementById('defaultPreserve');
const defaultWidthInput = document.getElementById('defaultWidth');
const defaultHeightInput = document.getElementById('defaultHeight');
const defaultFormatSelect = document.getElementById('defaultFormat');
const applyDefaultsBtn = document.getElementById('applyDefaults');
const statusSpan = document.getElementById('status');
const outputsSidebar = document.getElementById('outputsSidebar');

function render() {
  filesDiv.innerHTML = '';
  items.forEach((it, idx) => {
    const div = document.createElement('div');
    div.className = 'file';

    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = '/storage/originals/' + encodeURIComponent(it.name);
    img.onclick = () => window.open(img.src, '_blank');

    const meta = document.createElement('div');
    meta.className = 'file-meta';
    meta.innerHTML = `
      <strong>${it.name}</strong><br>
      Format: <select data-idx="${idx}" class="format"><option ${it.format==='png'?'selected':''}>png</option><option ${it.format==='jpg'?'selected':''}>jpg</option><option ${it.format==='webp'?'selected':''}>webp</option><option ${it.format==='heic'?'selected':''}>heic</option></select>
      Width: <input data-idx="${idx}" class="width" size="4" value="${it.width || ''}" />
      Height: <input data-idx="${idx}" class="height" size="4" value="${it.height || ''}" />
      Preserve: <input type="checkbox" data-idx="${idx}" class="preserve" ${it.preserve ? 'checked' : ''} />
    `;

    const actions = document.createElement('div');
    actions.className = 'file-actions';
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.onclick = () => { items.splice(idx, 1); render(); };
    actions.appendChild(removeBtn);

    div.appendChild(img);
    div.appendChild(meta);
    div.appendChild(actions);
    filesDiv.appendChild(div);
  });

  // disable process if no items
  document.getElementById('process').disabled = items.length === 0;
}

// ensure UI renders on load
render();

function handleFiles(files) {
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  fetch('/api/upload', { method: 'POST', body: form }).then(r=>r.json()).then(list=>{
    const defaultW = parseInt(defaultWidthInput.value) || null;
    const defaultH = parseInt(defaultHeightInput.value) || null;
    const defaultFormat = defaultFormatSelect.value || 'png';
    list.forEach(l=>items.push({ name: l.saved, preserve: defaultPreserveCheckbox.checked, width: defaultW, height: defaultH, format: defaultFormat }));
    render();
  }).catch(e=>{ console.error(e); statusSpan.textContent = 'Upload failed'; });
}

drop.addEventListener('drop', (e)=>{e.preventDefault(); handleFiles(e.dataTransfer.files)});
drop.addEventListener('dragover', (e)=>{e.preventDefault()});
picker.addEventListener('change', (e)=>handleFiles(e.target.files));

async function createDownloads(outputs) {
  const outputsDiv = document.getElementById('outputs');
  outputsDiv.innerHTML = '<h3>Processed outputs</h3>';
  outputsSidebar.innerHTML = '';
  outputs.forEach((fname, i) => {
    const div = document.createElement('div');
    div.className = 'output';
    const link = document.createElement('a');
    link.href = '/storage/outputs/' + encodeURIComponent(fname);
    link.textContent = fname;
    link.target = '_blank';

    const btn = document.createElement('button');
    btn.textContent = 'Download';
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      const a = document.createElement('a');
      a.href = link.href;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    div.appendChild(link);
    div.appendChild(document.createTextNode(' '));
    div.appendChild(btn);
    outputsDiv.appendChild(div);
  });

  // update sidebar with a concise count and quick action
  const count = outputs.length;
  const c = document.createElement('div');
  c.className = 'small muted';
  c.textContent = `${count} output(s)`;
  outputsSidebar.appendChild(c);
}

// updated process handler
document.getElementById('process').addEventListener('click', async ()=>{
  statusSpan.textContent = 'Processing...';
  const tasks = items.map((it, idx)=>{
    const format = document.querySelector(`.format[data-idx='${idx}']`).value;
    const widthVal = document.querySelector(`.width[data-idx='${idx}']`).value;
    const heightVal = document.querySelector(`.height[data-idx='${idx}']`).value;
    const width = widthVal ? parseInt(widthVal) : null;
    const height = heightVal ? parseInt(heightVal) : null;
    const preserve = !!document.querySelector(`.preserve[data-idx='${idx}']`).checked;
    return { name: it.name, action: 'convert', toFormat: format, width, height, preserve };
  });
  try{
    const res = await fetch('/api/process', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ tasks }) });
    const j = await res.json();
    const outputs = j.outputs || [];
    createDownloads(outputs);
    statusSpan.textContent = 'Done';
  }catch(e){
    console.error(e);
    statusSpan.textContent = 'Processing failed';
  }
});

// apply defaults to existing items
applyDefaultsBtn.addEventListener('click', ()=>{
  const defaultW = parseInt(defaultWidthInput.value) || null;
  const defaultH = parseInt(defaultHeightInput.value) || null;
  const defaultPreserve = !!defaultPreserveCheckbox.checked;
  const defaultFormat = defaultFormatSelect.value || 'png';
  items = items.map(it => ({ ...it, width: defaultW, height: defaultH, preserve: defaultPreserve, format: defaultFormat }));
  render();
});
