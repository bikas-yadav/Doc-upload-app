// frontend/admin.js
(function(){
  // set your backend URL here (used when window.API_BASE not provided)
  const BACKEND_URL = "https://doc-upload-app.onrender.com";
  // allow overriding from the page environment if needed
  const API_BASE = window.API_BASE || BACKEND_URL;

  // login elements
  const loginPage = document.getElementById('loginPage');
  const loginForm = document.getElementById('loginForm');
  const loginToken = document.getElementById('loginToken');
  const loginMsg = document.getElementById('loginMsg');

  // admin app elements
  const appRoot = document.getElementById('app');
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
  const logoutBtn = document.getElementById('logoutBtn');

  const viewerModal = document.getElementById('viewerModal');
  const viewerBody = document.getElementById('viewerBody');
  const viewerTitle = document.getElementById('viewerTitle');
  const closeViewer = document.getElementById('closeViewer');

  let continuationStack = [];
  let nextContinuation = null;
  let currentFiles = [];

  function showToast(msg, ms=3000){
    if(!toast) return;
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(()=>toast.classList.add('hidden'), ms);
  }

  // theme
  function applyTheme(theme){
    if(theme === 'light') { document.body.classList.add('light'); themeToggle.textContent='☀️'; }
    else { document.body.classList.remove('light'); themeToggle.textContent='🌙'; }
    localStorage.setItem('study_theme', theme);
  }
  if (themeToggle) {
    themeToggle.addEventListener('click', ()=>{
      const next = document.body.classList.contains('light') ? 'dark' : 'light';
      applyTheme(next);
    });
  }
  applyTheme(localStorage.getItem('study_theme') || 'dark');

  function humanSize(bytes){
    if(!bytes && bytes !== 0) return '';
    if(bytes < 1024) return bytes + ' B';
    const units=['KB','MB','GB','TB'];
    let i= -1; let v = bytes;
    do{ v = v/1024; i++; } while(v>=1024 && i<units.length-1);
    return v.toFixed((i<1)?0:1) + ' ' + units[i];
  }
  function isoShort(d){
    try{ return new Date(d).toLocaleString(); }catch(e){ return d; }
  }
  function buildHeaders(){ return { 'Accept':'application/json' }; }

  function ensureJsonOrShowLogin(res){
    const ct = res.headers.get('content-type') || '';
    if(!res.ok || !ct.includes('application/json')){
      // server returned non-json (likely 401 or HTML) -> show login
      showLogin();
      return false;
    }
    return true;
  }

  // helper to build backend download URL for a file key
  function makeDownloadUrl(key){
    return `${API_BASE}/files/download?key=${encodeURIComponent(key)}`;
  }

  // login flow
  async function doLogin(token){
    try{
      const trimmed = (token || '').trim();
      const res = await fetch(API_BASE + '/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: trimmed }),
        // must include credentials so session cookie set by backend is accepted
        credentials: 'include'
      });
      // try to parse JSON (server returns JSON on success/failure)
      const data = await res.json().catch(()=>null);
      if(!res.ok){
        const msg = data && data.message ? data.message : 'Invalid token';
        loginMsg.textContent = msg;
        return false;
      }
      if(data && data.ok){
        hideLogin();
        showToast('Logged in');
        await listFiles();
        return true;
      } else {
        loginMsg.textContent = (data && data.message) ? data.message : 'Invalid token';
        return false;
      }
    }catch(err){
      console.error('Login error', err);
      loginMsg.textContent = 'Network error';
      return false;
    }
  }

  function showLogin(){
    if (appRoot) appRoot.classList.add('hidden'), appRoot.setAttribute('aria-hidden','true');
    if (loginPage) loginPage.classList.remove('hidden');
  }
  function hideLogin(){
    if (loginPage) loginPage.classList.add('hidden');
    if (appRoot) appRoot.classList.remove('hidden'), appRoot.setAttribute('aria-hidden','false');
    if (loginToken) loginToken.value = '';
    if (loginMsg) loginMsg.textContent = '';
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      if(!loginMsg) return;
      loginMsg.textContent = '';
      const token = loginToken ? loginToken.value.trim() : '';
      if(!token) { loginMsg.textContent = 'Enter admin token'; return; }
      await doLogin(token);
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async ()=>{
      try{
        await fetch(API_BASE + '/admin/logout', { method: 'GET', credentials: 'include' });
      }catch(e){}
      showLogin();
    });
  }

  // API calls
  async function listFiles(continuation=null){
    const folder = (folderFilter && folderFilter.value || '').trim();
    const q = new URLSearchParams();
    q.set('limit', 200);
    if(folder) q.set('folder', folder);
    if(continuation) q.set('continuationToken', continuation);

    try{
      const res = await fetch(API_BASE + '/files?' + q.toString(), { headers: buildHeaders(), credentials: 'include' });
      if(!ensureJsonOrShowLogin(res)) return;
      const data = await res.json();
      currentFiles = data.files || [];
      nextContinuation = data.nextContinuationToken || null;
      renderFiles();
      if (prevBtn) prevBtn.disabled = continuationStack.length === 0;
      if (nextBtn) nextBtn.disabled = !nextContinuation;
      if (currentFolderEl) currentFolderEl.textContent = folder || 'root';
    }catch(err){
      console.error('Network error listing files', err);
      showToast('Network error. Are you logged in?');
      showLogin();
    }
  }

  function renderFilesFromList(list){
    currentFiles = list.slice();
    renderFiles();
  }

  function renderFiles(){
    if(!filesTableBody) return;
    filesTableBody.innerHTML = '';
    if(fileCountEl) fileCountEl.textContent = currentFiles.length;

    currentFiles.forEach(file => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input class="rowCheck" type="checkbox" data-key="${escapeHtml(file.key)}"/></td>
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
    const name = (file.name || '').toLowerCase();
    // prefer file.url if provided, otherwise use backend redirect link
    const url = file.url || makeDownloadUrl(file.key);
    if(name.match(/\.(png|jpe?g|gif|webp)$/)){
      return `<img src="${url}" alt="preview" style="max-width:72px;max-height:48px;object-fit:cover;border-radius:4px" />`;
    }
    if(name.match(/\.(pdf)$/)){
      return `<div style="font-size:12px;padding:6px;border-radius:6px;background:rgba(0,0,0,0.04);min-width:48px;text-align:center">PDF</div>`;
    }
    return `<div style="font-size:12px;padding:6px;border-radius:6px;background:rgba(0,0,0,0.04)">${escapeHtml((file.name||'').split('.').pop() || '')}</div>`;
  }

  function escapeHtml(s){ return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  async function uploadHandler(e){
    e.preventDefault();
    if(!uploadFile || !uploadFile.files.length) return showToast('Select a file first');
    const f = uploadFile.files[0];
    const form = new FormData();
    form.append('document', f);
    if(uploadFolder && uploadFolder.value) form.append('folder', uploadFolder.value);

    try{
      const res = await fetch(API_BASE + '/upload', { method:'POST', body:form, credentials: 'include' });
      if(!ensureJsonOrShowLogin(res)) return;
      const data = await res.json();
      if(!res.ok){ showToast('Upload failed: ' + (data.message || res.statusText)); return; }
      showToast('Uploaded: ' + (data.file && data.file.originalName ? data.file.originalName : f.name));
      if(uploadForm) uploadForm.reset();
      await listFiles();
    }catch(err){
      console.error('Upload error', err);
      showToast('Upload failed (network)');
    }
  }

  async function deleteFile(key){
    if(!confirm('Delete this file?')) return;
    try{
      const res = await fetch(API_BASE + '/files', { method:'DELETE', headers: Object.assign({'Content-Type':'application/json'}, buildHeaders()), body: JSON.stringify({ key }), credentials: 'include' });
      if(!ensureJsonOrShowLogin(res)) return;
      const data = await res.json();
      if(!res.ok){ showToast('Delete failed'); return; }
      showToast('Deleted');
      await listFiles();
    }catch(err){
      console.error('Delete error', err);
      showToast('Delete failed (network)');
    }
  }

  function downloadFile(key){
    // open backend redirect URL (will redirect to signed S3 URL)
    window.open(makeDownloadUrl(key), '_blank');
  }

  async function renameFlow(file){
    const newName = prompt('Enter new base name (without extension)', (file.name || '').replace(/\.[^.]+$/,''));
    if(!newName) return;
    try{
      const res = await fetch(API_BASE + '/files/rename', { method:'PUT', headers: Object.assign({'Content-Type':'application/json'}, buildHeaders()), body: JSON.stringify({ key: file.key, newName }), credentials: 'include' });
      if(!ensureJsonOrShowLogin(res)) return;
      const data = await res.json();
      if(!res.ok){ showToast('Rename failed: ' + (data.message || '')); return; }
      showToast('Renamed');
      await listFiles();
    }catch(err){
      console.error('Rename error', err);
      showToast('Rename failed (network)');
    }
  }

  async function moveFlow(file){
    const newFolder = prompt('Move to folder (name)', file.folder || 'root');
    if(newFolder===null) return;
    try{
      const res = await fetch(API_BASE + '/files/move', { method:'PUT', headers: Object.assign({'Content-Type':'application/json'}, buildHeaders()), body: JSON.stringify({ key: file.key, newFolder }), credentials: 'include' });
      if(!ensureJsonOrShowLogin(res)) return;
      const data = await res.json();
      if(!res.ok){ showToast('Move failed'); return; }
      showToast('Moved');
      await listFiles();
    }catch(err){
      console.error('Move error', err);
      showToast('Move failed (network)');
    }
  }

  async function getSelectedKeys(){
    return Array.from(document.querySelectorAll('.rowCheck:checked')).map(i=>i.dataset.key);
  }

  async function deleteSelected(){
    const keys = await getSelectedKeys();
    if(!keys.length) return showToast('No files selected');
    if(!confirm(`Delete ${keys.length} file(s)?`)) return;
    try{
      for(const k of keys){
        const res = await fetch(API_BASE + '/files', { method:'DELETE', headers: Object.assign({'Content-Type':'application/json'}, buildHeaders()), body: JSON.stringify({ key: k }), credentials: 'include' });
        if(!ensureJsonOrShowLogin(res)) return;
      }
      showToast('Deleted selected');
      await listFiles();
    }catch(err){
      console.error('Bulk delete error', err);
      showToast('Bulk delete failed (network)');
    }
  }

  async function downloadSelected(){
    const keys = await getSelectedKeys();
    if(!keys.length) return showToast('No files selected');
    for(const k of keys){ window.open(makeDownloadUrl(k), '_blank'); }
  }

  // Preview / Viewer
  function openPreview(file){
    viewerTitle.textContent = file.name || '';
    viewerBody.innerHTML = '';
    const name = (file.name || '').toLowerCase();
    // prefer file.url if provided, otherwise use backend redirect link
    const url = file.url || makeDownloadUrl(file.key);

    if(name.match(/\.(png|jpe?g|gif|webp)$/)){
      const img = document.createElement('img'); img.src = url; img.style.maxWidth='100%'; img.style.maxHeight='100%'; viewerBody.appendChild(img);
    } else if(name.match(/\.(pdf)$/)){
      const iframe = document.createElement('iframe');
      iframe.src = url + '#toolbar=0&navpanes=0';
      iframe.setAttribute('title', file.name || 'PDF');
      iframe.style.width = '100%';
      iframe.style.height = '80vh';
      viewerBody.appendChild(iframe);
    } else if(name.match(/\.(mp4|webm)$/)){
      const vid = document.createElement('video'); vid.controls=true; vid.src = url; vid.style.maxWidth='100%'; viewerBody.appendChild(vid);
    } else {
      // attempt to fetch as text (may redirect to signed S3 url)
      fetch(url, { credentials: 'include' }).then(r=>r.text()).then(txt=>{
        const pre = document.createElement('pre'); pre.textContent = txt.slice(0, 20000); viewerBody.appendChild(pre);
      }).catch(()=>{ const p = document.createElement('div'); p.textContent = 'Preview not available'; viewerBody.appendChild(p); });
    }
    if(viewerModal){
      viewerModal.classList.remove('hidden');
      viewerModal.setAttribute('aria-hidden', 'false');
      setTimeout(()=>{ if(closeViewer) closeViewer.focus(); }, 40);
    }
  }

  function closePreview(){
    if(viewerModal){
      viewerModal.classList.add('hidden');
      viewerModal.setAttribute('aria-hidden', 'true');
    }
    if(viewerBody) viewerBody.innerHTML = '';
  }

  if(closeViewer) closeViewer.addEventListener('click', ()=>{ closePreview(); });
  if(viewerModal) viewerModal.addEventListener('click', (e)=>{ if(e.target === viewerModal) closePreview(); });
  const modalInner = document.querySelector('.modal-inner');
  if(modalInner){ modalInner.addEventListener('click', (e)=>e.stopPropagation()); }
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && viewerModal && !viewerModal.classList.contains('hidden')){ closePreview(); } });

  // events
  if(uploadForm) uploadForm.addEventListener('submit', uploadHandler);
  const clearUploadBtn = document.getElementById('clearUpload');
  if(clearUploadBtn) clearUploadBtn.addEventListener('click', ()=>{ if(uploadForm) uploadForm.reset(); });
  if(refreshBtn) refreshBtn.addEventListener('click', ()=>listFiles());
  const deleteSelectedBtn = document.getElementById('deleteSelected');
  if(deleteSelectedBtn) deleteSelectedBtn.addEventListener('click', deleteSelected);
  const downloadSelectedBtn = document.getElementById('downloadSelected');
  if(downloadSelectedBtn) downloadSelectedBtn.addEventListener('click', downloadSelected);
  if(prevBtn) prevBtn.addEventListener('click', async ()=>{ const prev = continuationStack.pop() || null; await listFiles(prev); });
  if(nextBtn) nextBtn.addEventListener('click', async ()=>{ if(!nextContinuation) return; continuationStack.push(nextContinuation); await listFiles(nextContinuation); });
  if(selectAll) selectAll.addEventListener('change', ()=>{ document.querySelectorAll('.rowCheck').forEach(ch=>ch.checked = selectAll.checked); });

  // search debounce
  let searchTimer = null;
  if(searchInput){
    searchInput.addEventListener('input', ()=>{ clearTimeout(searchTimer); searchTimer = setTimeout(()=>{ const q = searchInput.value.trim().toLowerCase(); if(!q) return renderFiles(); const filtered = currentFiles.filter(f=> (f.name||'').toLowerCase().includes(q) || (f.folder||'').toLowerCase().includes(q)); renderFilesFromList(filtered); }, 300); });
  }

  // initial check: attempt to load files; if not authenticated, server will respond non-json and we show login
  (async ()=>{
    await listFiles();
    // If server responded non-json, showLogin will have been called by ensureJsonOrShowLogin
  })();

})();
