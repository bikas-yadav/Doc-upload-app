// admin.js
(function(){
  // -------- config --------
  const API_BASE = window.API_BASE || location.origin;
  const uploadForm = document.getElementById('uploadForm');
  const uploadFile = document.getElementById('uploadFile');
  const uploadFolder = document.getElementById('uploadFolder');
  const filesTableBody = document.querySelector('#filesTable tbody');
  const fileCountEl = document.getElementById('fileCount');
  const folderFilter = document.getElementById('folderFilter');
  const searchInput = document.getElementById('searchInput');
  const toast = document.getElementById('toast');
  const refreshBtn = document.getElementById('refreshBtn');
  const prevBtn = document.getElementById('prevPage');
  const nextBtn = document.getElementById('nextPage');
  const currentFolderEl = document.getElementById('currentFolder');
  const selectAll = document.getElementById('selectAll');
  const themeToggle = document.getElementById('themeToggle');

  const viewerModal = document.getElementById('viewerModal');
  const viewerBody = document.getElementById('viewerBody');
  const viewerTitle = document.getElementById('viewerTitle');
  const closeViewer = document.getElementById('closeViewer');

  let continuationStack = [];
  let nextContinuation = null;
  let currentFiles = [];

  function showToast(msg, ms=3000){
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(()=>toast.classList.add('hidden'), ms);
  }

  // theme
  function applyTheme(theme){
    if(theme === 'light') document.body.classList.add('light'), themeToggle.textContent='☀️';
    else document.body.classList.remove('light'), themeToggle.textContent='🌙';
    localStorage.setItem('study_theme', theme);
  }
  themeToggle.addEventListener('click', ()=>{
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    applyTheme(next);
  });
  // apply persisted theme
  applyTheme(localStorage.getItem('study_theme') || 'dark');

  // helper to format bytes
  function humanSize(bytes){
    if(bytes < 1024) return bytes + ' B';
    const units=['KB','MB','GB','TB'];
    let i= -1; do{ bytes /=1024; i++; } while(bytes>=1024 && i<units.length-1);
    return bytes.toFixed( (i<1)?0:1) + ' ' + units[i];
  }

  function isoShort(d){
    try{ return new Date(d).toLocaleString(); }catch(e){ return d; }
  }

  function buildHeaders(){
    return { 'Accept':'application/json' };
  }

  async function listFiles(continuation=null){
    const folder = (folderFilter.value || '').trim();
    const q = new URLSearchParams();
    q.set('limit', 200);
    if(folder) q.set('folder', folder);
    if(continuation) q.set('continuationToken', continuation);

    const res = await fetch(API_BASE + '/files?' + q.toString(), { headers: buildHeaders() });
    if(!res.ok){ showToast('Failed to fetch files'); return; }
    const data = await res.json();
    currentFiles = data.files || [];
    nextContinuation = data.nextContinuationToken || null;
    renderFiles();

    // pagination state
    prevBtn.disabled = continuationStack.length === 0;
    nextBtn.disabled = !nextContinuation;
    currentFolderEl.textContent = folder || 'root';
  }

  function renderFiles(){
    filesTableBody.innerHTML = '';
    fileCountEl.textContent = currentFiles.length;

      currentFiles.forEach(file => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input class="rowCheck" type="checkbox" data-key="${file.key}"/></td>
        <td class="previewCell">${previewHTML(file)}</td>
        <td class="nameCell">${escapeHtml(file.name)}</td>
        <td class="folderCell">${escapeHtml(file.folder)}</td>
        <td class="sizeCell">${humanSize(file.size)}</td>
        <td class="modCell">${isoShort(file.lastModified)}</td>
        <td class="actionsCell"></td>
      `;

      const actions = tr.querySelector('.actionsCell');

      const previewBtn = document.createElement('button'); previewBtn.textContent='Preview';
      previewBtn.onclick = ()=>openPreview(file);
      actions.appendChild(previewBtn);

      const downloadBtn = document.createElement('button'); downloadBtn.textContent='Download';
      downloadBtn.onclick = ()=>downloadFile(file.key);
      actions.appendChild(downloadBtn);

      const renameBtn = document.createElement('button'); renameBtn.textContent='Rename';
      renameBtn.onclick = ()=>renameFlow(file);
      actions.appendChild(renameBtn);

      const moveBtn = document.createElement('button'); moveBtn.textContent='Move';
      moveBtn.onclick = ()=>moveFlow(file);
      actions.appendChild(moveBtn);

      const delBtn = document.createElement('button'); delBtn.textContent='Delete';
      delBtn.onclick = ()=>deleteFile(file.key);
      actions.appendChild(delBtn);

      filesTableBody.appendChild(tr);
    });
  }

  function previewHTML(file){
    const name = file.name.toLowerCase();
    if(name.match(/\.(png|jpe?g|gif|webp)$/)){
      return `<img src="${file.url}" alt="preview" />`;
    }
    if(name.match(/\.(pdf)$/)){
      // show a small PDF badge; user can click Preview action to open embedded viewer
      return `<div style="font-size:12px;padding:6px;border-radius:6px;background:rgba(0,0,0,0.04);min-width:48px;text-align:center">PDF</div>`;
    }
    return `<div style="font-size:12px;padding:6px;border-radius:6px;background:rgba(0,0,0,0.04)">${escapeHtml(file.name.split('.').pop())}</div>`;
  }

  function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  async function uploadHandler(e){
    e.preventDefault();
    if(!uploadFile.files.length) return showToast('Select a file first');
    const f = uploadFile.files[0];
    const form = new FormData();
    form.append('document', f);
    if(uploadFolder.value) form.append('folder', uploadFolder.value);

    const res = await fetch(API_BASE + '/upload', { method:'POST', body:form });
    const data = await res.json();
    if(!res.ok){ showToast('Upload failed: ' + (data.message || res.statusText)); return; }
    showToast('Uploaded: ' + data.file.originalName);
    uploadForm.reset();
    await listFiles();
  }

  async function deleteFile(key){
    if(!confirm('Delete this file?')) return;
    const res = await fetch(API_BASE + '/files', { method:'DELETE', headers: Object.assign({'Content-Type':'application/json'}, buildHeaders()), body: JSON.stringify({ key }) });
    const data = await res.json();
    if(!res.ok){ showToast('Delete failed'); return; }
    showToast('Deleted');
    await listFiles();
  }

  async function downloadFile(key){
    // open redirect endpoint
    window.open(API_BASE + '/files/download?key=' + encodeURIComponent(key), '_blank');
  }

  async function renameFlow(file){
    const newName = prompt('Enter new base name (without extension)', file.name.replace(/\.[^.]+$/,''));
    if(!newName) return;
    const res = await fetch(API_BASE + '/files/rename', { method:'PUT', headers: Object.assign({'Content-Type':'application/json'}, buildHeaders()), body: JSON.stringify({ key: file.key, newName }) });
    const data = await res.json();
    if(!res.ok){ showToast('Rename failed: ' + (data.message || '')); return; }
    showToast('Renamed');
    await listFiles();
  }

  async function moveFlow(file){
    const newFolder = prompt('Move to folder (name)', file.folder || 'root');
    if(newFolder===null) return;
    const res = await fetch(API_BASE + '/files/move', { method:'PUT', headers: Object.assign({'Content-Type':'application/json'}, buildHeaders()), body: JSON.stringify({ key: file.key, newFolder }) });
    const data = await res.json();
    if(!res.ok){ showToast('Move failed'); return; }
    showToast('Moved');
    await listFiles();
  }

  // bulk actions
  async function getSelectedKeys(){
    return Array.from(document.querySelectorAll('.rowCheck:checked')).map(i=>i.dataset.key);
  }

  async function deleteSelected(){
    const keys = await getSelectedKeys();
    if(!keys.length) return showToast('No files selected');
    if(!confirm(`Delete ${keys.length} file(s)?`)) return;
    for(const k of keys){
      await fetch(API_BASE + '/files', { method:'DELETE', headers: Object.assign({'Content-Type':'application/json'}, buildHeaders()), body: JSON.stringify({ key: k }) });
    }
    showToast('Deleted selected');
    await listFiles();
  }

  async function downloadSelected(){
    const keys = await getSelectedKeys();
    if(!keys.length) return showToast('No files selected');
    for(const k of keys){ window.open(API_BASE + '/files/download?key=' + encodeURIComponent(k), '_blank'); }
  }

  // Preview / Viewer
  function openPreview(file){
    viewerTitle.textContent = file.name;
    viewerBody.innerHTML = '';
    const name = file.name.toLowerCase();
    if(name.match(/\.(png|jpe?g|gif|webp)$/)){
      const img = document.createElement('img'); img.src = file.url; img.style.maxWidth='100%'; img.style.maxHeight='100%'; viewerBody.appendChild(img);
    } else if(name.match(/\.(pdf)$/)){
      // embed PDF in iframe using signed URL; browsers typically support PDF viewing
      const iframe = document.createElement('iframe');
      iframe.src = file.url + '#toolbar=0&navpanes=0';
      iframe.setAttribute('title', file.name);
      viewerBody.appendChild(iframe);
    } else if(name.match(/\.(mp4|webm)$/)){
      const vid = document.createElement('video'); vid.controls=true; vid.src=file.url; vid.style.maxWidth='100%'; viewerBody.appendChild(vid);
    } else {
      // attempt to fetch text/plain and show
      fetch(file.url).then(r=>r.text()).then(txt=>{
        const pre = document.createElement('pre'); pre.textContent = txt.slice(0, 20000); viewerBody.appendChild(pre);
      }).catch(()=>{
        const p = document.createElement('div'); p.textContent = 'Preview not available'; viewerBody.appendChild(p);
      });
    }
    // show modal and set accessibility attributes
    viewerModal.classList.remove('hidden');
    viewerModal.setAttribute('aria-hidden', 'false');
    // trap focus briefly by focusing close button
    setTimeout(()=>{ closeViewer.focus(); }, 40);
  }

  function closePreview(){
    viewerModal.classList.add('hidden');
    viewerModal.setAttribute('aria-hidden', 'true');
    viewerBody.innerHTML = '';
  }

  // close button
  closeViewer.addEventListener('click', ()=>{ closePreview(); });

  // allow clicking outside modal-inner to close
  viewerModal.addEventListener('click', (e)=>{
    // if clicked directly on the overlay (viewerModal) -> close
    if(e.target === viewerModal) closePreview();
  });

  // prevent clicks inside modal-inner from bubbling to overlay
  const modalInner = document.querySelector('.modal-inner');
  if(modalInner){ modalInner.addEventListener('click', (e)=>e.stopPropagation()); }

  // allow ESC key to close
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape' && !viewerModal.classList.contains('hidden')){
      closePreview();
    }
  });

  // events
  uploadForm.addEventListener('submit', uploadHandler);
  document.getElementById('clearUpload').addEventListener('click', ()=>uploadForm.reset());
  refreshBtn.addEventListener('click', ()=>listFiles());
  document.getElementById('deleteSelected').addEventListener('click', deleteSelected);
  document.getElementById('downloadSelected').addEventListener('click', downloadSelected);
  prevBtn.addEventListener('click', async ()=>{
    const prev = continuationStack.pop() || null;
    await listFiles(prev);
  });
  nextBtn.addEventListener('click', async ()=>{
    if(!nextContinuation) return;
    continuationStack.push(nextContinuation);
    await listFiles(nextContinuation);
  });
  selectAll.addEventListener('change', ()=>{
    document.querySelectorAll('.rowCheck').forEach(ch=>ch.checked = selectAll.checked);
  });

  // search filter debounce
  let searchTimer = null;
  searchInput.addEventListener('input', ()=>{ clearTimeout(searchTimer); searchTimer = setTimeout(()=>{ const q = searchInput.value.trim().toLowerCase(); if(!q) return renderFiles(); const filtered = currentFiles.filter(f=> (f.name||'').toLowerCase().includes(q) || (f.folder||'').toLowerCase().includes(q)); renderFilesFromList(filtered); }, 300); });

  function renderFilesFromList(list){
    currentFiles = list.slice();
    renderFiles();
  }

  // initial load
  (async ()=>{ await listFiles(); })();
})();
