let paths = [];

async function init() {
  const cfg = await window.settings.getConfig();

  document.getElementById('api-key').value  = cfg.apiKey || '';
  document.getElementById('interval').value = cfg.checkInIntervalMinutes || 30;
  document.getElementById('persona').value  = cfg.persona || '';

  paths = [...(cfg.todoPaths || [])];
  renderPaths();
}

function renderPaths() {
  const list = document.getElementById('paths-list');
  list.innerHTML = '';

  if (paths.length === 0) {
    list.innerHTML = '<p style="color:#6c7086;font-size:12px;margin-bottom:4px">No paths added yet.</p>';
    return;
  }

  paths.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'path-item';

    const input = document.createElement('input');
    input.type  = 'text';
    input.value = p;
    input.addEventListener('input', () => { paths[i] = input.value; });

    const remove = document.createElement('button');
    remove.className   = 'secondary remove-btn';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      paths.splice(i, 1);
      renderPaths();
    });

    row.appendChild(input);
    row.appendChild(remove);
    list.appendChild(row);
  });
}

document.getElementById('add-path-btn').addEventListener('click', () => {
  paths.push('');
  renderPaths();
  const inputs = document.querySelectorAll('.path-item input');
  inputs[inputs.length - 1]?.focus();
});

document.getElementById('browse-btn').addEventListener('click', async () => {
  const file = await window.settings.pickFile();
  if (file) {
    paths.push(file);
    renderPaths();
  }
});

document.getElementById('test-btn').addEventListener('click', async () => {
  const key    = document.getElementById('api-key').value.trim();
  const status = document.getElementById('key-status');
  status.textContent = 'Testing…';
  status.className   = 'status';

  if (!key) {
    status.textContent = '✗ Enter a key first';
    status.className   = 'status error';
    return;
  }

  const result = await window.settings.testApiKey(key);
  if (result.success) {
    status.textContent = '✓ Key is valid';
    status.className   = 'status ok';
  } else {
    status.textContent = `✗ ${result.error}`;
    status.className   = 'status error';
  }
});

document.getElementById('save-btn').addEventListener('click', async () => {
  const saveStatus = document.getElementById('save-status');
  saveStatus.textContent = '';

  const data = {
    apiKey:                 document.getElementById('api-key').value.trim(),
    todoPaths:              paths.filter(p => p.trim()),
    checkInIntervalMinutes: parseFloat(document.getElementById('interval').value) || 30,
    persona:                document.getElementById('persona').value.trim(),
  };

  const result = await window.settings.saveConfig(data);
  if (result.success) {
    saveStatus.textContent = '✓ Saved';
    saveStatus.className   = 'status ok centered';
    setTimeout(() => window.settings.close(), 700);
  } else {
    saveStatus.textContent = '✗ Failed to save';
    saveStatus.className   = 'status error centered';
  }
});

document.getElementById('cancel-btn').addEventListener('click', () => {
  window.settings.close();
});

init();
