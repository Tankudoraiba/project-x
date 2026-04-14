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

// helper to render empty state
function renderEmptyState() {
  if (items.length === 0) {
    filesDiv.classList.add('empty');
    filesDiv.innerHTML = '<div class="empty-msg">No files yet</div>';
  } else {
    filesDiv.classList.remove('empty');
  }
}

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
       <div class="file-title"><strong>${it.name}</strong></div>
       <div class="controls-row row-dim">
         <label>Width: <input data-idx="${idx}" class="width" size="6" placeholder="px" value="${it.width || ''}" /></label>
         <label>Height: <input data-idx="${idx}" class="height" size="6" placeholder="px" value="${it.height || ''}" /></label>
       </div>
       <div class="controls-row row-format">
        <select data-idx="${idx}" class="format"><option value="png" ${it.format==='png'?'selected':''}>png</option><option value="jpg" ${it.format==='jpg'?'selected':''}>jpg</option><option value="webp" ${it.format==='webp'?'selected':''}>webp</option><option value="heic" ${it.format==='heic'?'selected':''}>heic</option></select>
         <label style="display:flex;align-items:center;gap:6px">Preserve: <input type="checkbox" data-idx="${idx}" class="preserve" ${it.preserve ? 'checked' : ''} /></label>
       </div>
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
  renderEmptyState();
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
  outputs.forEach((fname, i) => {
    const div = document.createElement('div');
    div.className = 'output';

    const btn = document.createElement('button');
    btn.textContent = 'Download';
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      const a = document.createElement('a');
      a.href = '/storage/outputs/' + encodeURIComponent(fname);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    const link = document.createElement('a');
    link.href = '/storage/outputs/' + encodeURIComponent(fname);
    link.textContent = fname;
    link.target = '_blank';

    div.appendChild(btn);
    div.appendChild(document.createTextNode(' '));
    div.appendChild(link);
    outputsDiv.appendChild(div);
  });

  // Download All button action
  const downloadAll = document.getElementById('downloadAll');
  downloadAll.onclick = async ()=>{
    for (const fname of outputs) {
      const a = document.createElement('a');
      a.href = '/storage/outputs/' + encodeURIComponent(fname);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise(r=>setTimeout(r, 200));
    }
  };
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
