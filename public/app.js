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

const formatOptions = ['png','jpg','webp','heic'];

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
    img.src = '/api/download/original/' + encodeURIComponent(it.name);
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
        ${createCustomFormatSelect(idx, it.format)}
         <label style="display:flex;align-items:center;gap:6px">Preserve: <input type="checkbox" data-idx="${idx}" class="preserve" ${it.preserve ? 'checked' : ''} /></label>
       </div>
     `;

    const actions = document.createElement('div');
    actions.className = 'file-actions';
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.onclick = () => { items.splice(idx, 1); render(); try { picker.value = ''; } catch(e){} };
    actions.appendChild(removeBtn);

    if (it.output) {
      const downloadBtn = document.createElement('button');
      downloadBtn.textContent = 'Download Processed';
      downloadBtn.style.marginTop = '8px';
      downloadBtn.onclick = (e) => {
        e.preventDefault();
        const a = document.createElement('a');
        a.href = '/api/download/output/' + encodeURIComponent(it.output) + '?_=' + Date.now();
        a.download = it.output;
        document.body.appendChild(a);
        a.click();
        a.remove();
      };
      actions.appendChild(downloadBtn);
    }

    div.appendChild(img);
    div.appendChild(meta);
    div.appendChild(actions);
    filesDiv.appendChild(div);
  });

  // disable process if no items
  document.getElementById('process').disabled = items.length === 0;
  renderEmptyState();
  attachCustomDropdowns();
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
  }).catch(e=>{ console.error(e); statusSpan.textContent = 'Upload failed'; })
  // ensure the file input is reset so selecting the same file again will fire change
  .finally(()=>{ try { picker.value = ''; } catch(e){} });
}

drop.addEventListener('drop', (e)=>{e.preventDefault(); handleFiles(e.dataTransfer.files)});
drop.addEventListener('dragover', (e)=>{e.preventDefault()});
picker.addEventListener('change', (e)=>handleFiles(e.target.files));

async function createDownloads(outputs) {
  outputs.forEach(({ input, output }) => {
    const idx = items.findIndex(it => it.name === input);
    if (idx !== -1) {
      items[idx].output = output;
    }
  });
  render();
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

function createCustomFormatSelect(idx, selected) {
  return `
    <div class="custom-select" data-idx="${idx}">
      <button type="button" class="custom-select-trigger">${selected}</button>
      <div class="custom-options">
        ${formatOptions.map(f => `<div class="custom-option${f === selected ? ' selected' : ''}" data-value="${f}">${f}</div>`).join('')}
      </div>
      <input type="hidden" class="format" data-idx="${idx}" value="${selected}" />
    </div>
  `;
}

function closeAllDropdowns() {
  document.querySelectorAll('.custom-select.open').forEach(el => el.classList.remove('open'));
}

function attachCustomDropdowns() {
  document.querySelectorAll('.custom-select').forEach(select => {
    const trigger = select.querySelector('.custom-select-trigger');
    const options = select.querySelectorAll('.custom-option');
    if (!trigger) return;

    trigger.onclick = e => {
      e.stopPropagation();
      closeAllDropdowns();
      select.classList.toggle('open');
    };

    options.forEach(option => {
      option.onclick = e => {
        e.stopPropagation();
        const value = option.dataset.value;
        const idx = select.dataset.idx;
        const hidden = select.querySelector(`input.format[data-idx="${idx}"]`);
        hidden.value = value;
        select.querySelector('.custom-select-trigger').textContent = value;
        options.forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
        select.classList.remove('open');
        if (items[idx]) items[idx].format = value;
      };
    });
  });
}

document.addEventListener('click', closeAllDropdowns);

// apply defaults to existing items
applyDefaultsBtn.addEventListener('click', ()=>{
  const defaultW = parseInt(defaultWidthInput.value) || null;
  const defaultH = parseInt(defaultHeightInput.value) || null;
  const defaultPreserve = !!defaultPreserveCheckbox.checked;
  const defaultFormat = defaultFormatSelect.value || 'png';
  items = items.map(it => ({ ...it, width: defaultW, height: defaultH, preserve: defaultPreserve, format: defaultFormat }));
  render();
});
