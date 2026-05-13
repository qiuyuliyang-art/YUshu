// State
let contentList = [];
let currentContentId = null;
let currentJobId = null;
let platformStatuses = {};

// API helpers
const api = {
  async get(url) {
    const res = await fetch(url);
    return res.json();
  },
  async post(url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },
  async put(url, data) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },
  async del(url) {
    const res = await fetch(url, { method: 'DELETE' });
    return res.json();
  },
};

// --- Platform Account Status ---

let currentLoginPlatform = null;

async function checkPlatformStatus() {
  const douyinInfo = document.getElementById('douyinAccountInfo');
  const xhsInfo = document.getElementById('xhsAccountInfo');
  douyinInfo.textContent = '检测中...';
  douyinInfo.className = 'account-info';
  xhsInfo.textContent = '检测中...';
  xhsInfo.className = 'account-info';

  try {
    const statuses = await api.get('/api/accounts/status');
    for (const s of statuses) {
      const infoEl = document.getElementById(s.platform === 'douyin' ? 'douyinAccountInfo' : 'xhsAccountInfo');
      const loginBtn = document.getElementById(s.platform === 'douyin' ? 'loginDouyinBtn' : 'loginXhsBtn');
      if (!infoEl) continue;
      if (s.loggedIn && s.cookieValid) {
        infoEl.textContent = s.message || '已登录';
        infoEl.className = 'account-info logged-in';
        if (loginBtn) loginBtn.style.display = 'none';
      } else {
        infoEl.textContent = s.message || '未登录';
        infoEl.className = 'account-info not-logged-in';
        if (loginBtn) loginBtn.style.display = 'inline-block';
      }
      platformStatuses[s.platform] = s;
    }
  } catch (err) {
    douyinInfo.textContent = '检测失败';
    xhsInfo.textContent = '检测失败';
  }
}

// --- Login Flow ---

async function loginPlatform(platform) {
  currentLoginPlatform = platform;
  const platformName = platform === 'douyin' ? '抖音' : '小红书';

  document.getElementById('loginModalTitle').textContent = `登录 ${platformName}`;
  document.getElementById('loginStatusText').textContent = '正在打开浏览器...';
  document.getElementById('loginQrHint').style.display = 'none';
  document.getElementById('loginConfirmBtn').style.display = 'none';
  document.getElementById('loginSpinner').style.display = 'block';
  document.getElementById('loginModal').style.display = 'flex';

  try {
    const result = await api.post('/api/accounts/login', { platform });

    if (result.success) {
      document.getElementById('loginSpinner').style.display = 'none';
      document.getElementById('loginStatusText').textContent = result.message || '登录成功';
      document.getElementById('loginConfirmBtn').style.display = 'inline-block';
      document.getElementById('loginConfirmBtn').textContent = '完成';
      checkPlatformStatus();
      return;
    }

    // 需要用户扫码 - 显示详细提示
    document.getElementById('loginSpinner').style.display = 'none';
    document.getElementById('loginQrHint').style.display = 'block';
    document.getElementById('loginConfirmBtn').style.display = 'inline-block';
    document.getElementById('loginConfirmBtn').textContent = '已完成登录';
    document.getElementById('loginStatusText').textContent = result.message || '请在浏览器中扫码登录';
    document.getElementById('loginQrHint').innerHTML = `
      <p style="margin-top:16px;font-size:14px;font-weight:600;color:#374151;">请在浏览器中扫码登录</p>
      <p class="form-hint" style="margin-top:8px">登录完成后，系统会自动检测（最长等待5分钟）</p>
      <p class="form-hint" style="margin-top:4px">登录成功后浏览器会自动关闭</p>
    `;

    // 开始轮询登录状态
    pollLoginStatus(platform);
  } catch (err) {
    document.getElementById('loginStatusText').textContent = '打开浏览器失败: ' + err.message;
    document.getElementById('loginSpinner').style.display = 'none';
    document.getElementById('loginConfirmBtn').style.display = 'inline-block';
  }
}

async function pollLoginStatus(platform) {
  const poll = async () => {
    try {
      const result = await api.get(`/api/accounts/login/${platform}/wait`);
      if (result.success) {
        document.getElementById('loginSpinner').style.display = 'none';
        document.getElementById('loginStatusText').textContent = result.message || '登录成功';
        document.getElementById('loginConfirmBtn').style.display = 'inline-block';
        document.getElementById('loginConfirmBtn').textContent = '完成';
        checkPlatformStatus();
        return;
      }
      // 继续轮询
      setTimeout(poll, 3000);
    } catch {
      setTimeout(poll, 5000);
    }
  };
  poll();
}

function hideLoginModal() {
  document.getElementById('loginModal').style.display = 'none';
  currentLoginPlatform = null;
}

function cancelLogin() {
  hideLoginModal();
}

async function confirmLoginDone() {
  if (!currentLoginPlatform) return;
  hideLoginModal();
  await checkPlatformStatus();
}

// --- Content List ---

async function loadContentList() {
  contentList = await api.get('/api/content');
  renderContentList();
}

function renderContentList() {
  const container = document.getElementById('contentItems');
  if (contentList.length === 0) {
    container.innerHTML = '<p style="padding:16px;color:#999;font-size:13px;text-align:center">暂无内容</p>';
    return;
  }

  container.innerHTML = contentList.map((c) => {
    const typeMap = { 'image-text': '图文', 'video': '视频', 'carousel': '轮播' };
    const active = c.id === currentContentId ? 'active' : '';

    // Publish status badges
    let publishBadges = '';
    if (c.publishStatus) {
      if (c.publishStatus.douyin === 'published') publishBadges += '<span class="publish-badge published">抖音已发</span>';
      if (c.publishStatus.xiaohongshu === 'published') publishBadges += '<span class="publish-badge published">小红书已发</span>';
      if (c.publishStatus.douyin === 'pending') publishBadges += '<span class="publish-badge pending">抖音待发</span>';
      if (c.publishStatus.xiaohongshu === 'pending') publishBadges += '<span class="publish-badge pending">小红书待发</span>';
    }

    // Generating indicator
    let generatingHtml = '';
    if (c.generateStatus === 'generating') {
      generatingHtml = '<div class="generating-indicator"><div class="spinner"></div>生成中...</div>';
    }

    return `
      <div class="content-card ${active}" onclick="selectContent('${c.id}')">
        <div class="card-title">${escapeHtml(c.title || '未命名')}</div>
        <div class="card-meta">${c.images.length} 张图片${c.video ? ' · 1 个视频' : ''}</div>
        <span class="card-type">${typeMap[c.contentType] || c.contentType}</span>
        ${publishBadges ? `<div class="publish-badges">${publishBadges}</div>` : ''}
        ${generatingHtml}
      </div>
    `;
  }).join('');
}

// --- Create Panel (Inline, no modal) ---

function showCreatePanel() {
  // 取消选中当前内容
  currentContentId = null;
  document.getElementById('createPanel').style.display = 'block';
  document.getElementById('editorForm').style.display = 'none';
  document.getElementById('newTopic').value = '';
  document.getElementById('newDescription').value = '';
  document.getElementById('newTopic').focus();
  renderContentList();
}

async function createAndGenerate() {
  const topic = document.getElementById('newTopic').value.trim();
  if (!topic) {
    alert('请输入内容主题');
    return;
  }

  const description = document.getElementById('newDescription').value.trim();
  const style = document.getElementById('newStyle').value;
  const imageCount = parseInt(document.getElementById('newImageCount').value);
  const contentType = document.getElementById('newContentType').value;

  // Show generating modal
  document.getElementById('generateModal').style.display = 'flex';
  document.getElementById('generateStatusText').textContent = '正在创建内容...';

  try {
    // Create content
    const item = await api.post('/api/content', {
      title: topic,
      description: description || topic,
      hashtags: [],
      contentType,
    });

    contentList.push(item);
    selectContent(item.id);
    renderContentList();

    // Start generation
    document.getElementById('generateStatusText').textContent = '正在生成图片，首次可能需要 1-2 分钟...';
    const result = await api.post('/api/generate', {
      contentId: item.id,
      topic,
      style,
      imageCount,
    });

    // Poll generation status
    pollGenerateStatus(item.id);
  } catch (err) {
    document.getElementById('generateModal').style.display = 'none';
    alert('创建失败: ' + err.message);
  }
}

async function pollGenerateStatus(contentId) {
  const poll = async () => {
    try {
      const status = await api.get(`/api/generate/status/${contentId}`);

      if (status.status === 'done') {
        document.getElementById('generateModal').style.display = 'none';
        // Reload content to get updated images
        const updated = await api.get(`/api/content/${contentId}`);
        const idx = contentList.findIndex((c) => c.id === contentId);
        if (idx !== -1) contentList[idx] = updated;
        if (currentContentId === contentId) selectContent(contentId);
        renderContentList();
        return;
      }

      if (status.status === 'error') {
        document.getElementById('generateModal').style.display = 'none';
        alert('图片生成失败，请手动上传图片');
        return;
      }

      document.getElementById('generateStatusText').textContent =
        `正在生成图片 (${status.imageCount} 张已完成)...`;
      setTimeout(poll, 2000);
    } catch {
      setTimeout(poll, 3000);
    }
  };
  poll();
}

// --- Content Operations ---

async function selectContent(id) {
  currentContentId = id;
  const item = contentList.find((c) => c.id === id);
  if (!item) return;

  // 切换到编辑器视图
  document.getElementById('createPanel').style.display = 'none';
  document.getElementById('editorForm').style.display = 'block';

  document.getElementById('contentType').value = item.contentType;
  document.getElementById('titleInput').value = item.title;
  document.getElementById('descInput').value = item.description;
  document.getElementById('hashtagsInput').value = item.hashtags.join(', ');

  updateCharCount('title');
  updateCharCount('desc');
  renderImageGallery(item.images);
  renderContentList();
  updatePublishButton();
}

async function saveContent() {
  if (!currentContentId) return;
  const hashtags = document.getElementById('hashtagsInput').value
    .split(/[,，\s]+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean);

  await api.put(`/api/content/${currentContentId}`, {
    title: document.getElementById('titleInput').value,
    description: document.getElementById('descInput').value,
    contentType: document.getElementById('contentType').value,
    hashtags,
  });
  await loadContentList();
}

async function deleteCurrentContent() {
  if (!currentContentId) return;
  if (!confirm('确定删除这个内容？')) return;
  await api.del(`/api/content/${currentContentId}`);
  currentContentId = null;
  showCreatePanel();
  await loadContentList();
}

function updateCurrentContent() {
  // Just mark as dirty, save on explicit save button
}

// --- File Upload ---

async function handleFileUpload(files) {
  if (!currentContentId || files.length === 0) return;
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  const res = await fetch(`/api/content/${currentContentId}/upload`, {
    method: 'POST',
    body: formData,
  });
  const updated = await res.json();
  if (updated) {
    renderImageGallery(updated.images);
    const idx = contentList.findIndex((c) => c.id === currentContentId);
    if (idx !== -1) contentList[idx] = updated;
  }
}

function renderImageGallery(images) {
  const gallery = document.getElementById('imageGallery');
  if (images.length === 0) {
    gallery.innerHTML = '';
    return;
  }
  gallery.innerHTML = images.map((img) => {
    const filename = img.split(/[/\\]/).pop();
    return `
      <div class="image-thumb">
        <img src="/uploads/${currentContentId}/${filename}" alt="image" onerror="this.style.display='none'">
      </div>
    `;
  }).join('');
}

// --- Character Count ---

function updateCharCount(field) {
  const input = document.getElementById(field === 'title' ? 'titleInput' : 'descInput');
  const counter = document.getElementById(field === 'title' ? 'titleCount' : 'descCount');
  const max = field === 'title' ? 50 : 1000;
  counter.textContent = `${input.value.length}/${max}`;
}

// --- Publish ---

function updatePublishButton() {
  const btn = document.getElementById('publishBtn');
  const douyin = document.getElementById('platformDouyin').checked;
  const xhs = document.getElementById('platformXhs').checked;
  btn.disabled = !currentContentId || (!douyin && !xhs);
}

async function startPublish() {
  if (!currentContentId) return;
  const platforms = [];
  if (document.getElementById('platformDouyin').checked) platforms.push('douyin');
  if (document.getElementById('platformXhs').checked) platforms.push('xiaohongshu');
  if (platforms.length === 0) return;

  const btn = document.getElementById('publishBtn');
  btn.disabled = true;
  btn.textContent = '发布中...';

  const logContent = document.getElementById('logContent');
  logContent.innerHTML = '<div>Starting publish...</div>';

  try {
    const result = await api.post('/api/publish', {
      contentId: currentContentId,
      platforms,
    });
    currentJobId = result.jobId;

    // Mark as pending
    const publishStatus = {};
    for (const p of platforms) publishStatus[p] = 'pending';
    await api.put(`/api/content/${currentContentId}`, { publishStatus });

    pollJobStatus(result.jobId);
  } catch (err) {
    logContent.innerHTML += `<div style="color:#f87171">Error: ${err.message}</div>`;
    btn.disabled = false;
    btn.textContent = '发布到平台';
  }
}

async function pollJobStatus(jobId) {
  const poll = async () => {
    try {
      const job = await api.get(`/api/status/${jobId}`);
      const logContent = document.getElementById('logContent');
      logContent.innerHTML = job.logs.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
      logContent.scrollTop = logContent.scrollHeight;

      if (job.status === 'chrome-open' || job.status === 'completed') {
        const btn = document.getElementById('publishBtn');
        btn.disabled = false;
        btn.textContent = '发布到平台';

        // Update publish status to published
        const content = contentList.find((c) => c.id === currentContentId);
        if (content) {
          const publishStatus = { ...content.publishStatus };
          for (const p of job.platforms) {
            if (job.platformStatus[p] === 'ready') publishStatus[p] = 'published';
          }
          await api.put(`/api/content/${currentContentId}`, { publishStatus });
          await loadContentList();
        }
        return;
      }

      if (job.status === 'failed') {
        const btn = document.getElementById('publishBtn');
        btn.disabled = false;
        btn.textContent = '发布到平台';
        return;
      }

      setTimeout(poll, 2000);
    } catch {
      setTimeout(poll, 3000);
    }
  };
  poll();
}

// --- Utilities ---

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Event Listeners ---

document.getElementById('platformDouyin').addEventListener('change', updatePublishButton);
document.getElementById('platformXhs').addEventListener('change', updatePublishButton);

// Keyboard shortcut
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('generateModal').style.display = 'none';
  }
});

// --- Init ---

loadContentList();
checkPlatformStatus();
