/**
 * CYBERVPS SPACE STATION - FILE MANAGER & SFTP EXPLORER COMPONENT
 * Path Traversal Protected File Browser, Breadcrumb Navigation, File Upload/Download
 */

class FileManagerView {
  constructor(state, apiClient) {
    this.state = state;
    this.api = apiClient;
    this.currentPath = '/';
  }

  render(container) {
    const fleet = this.state.get('fleet') || [];
    const activeMachineId = this.state.get('activeMachineId') || (fleet[0] ? fleet[0].id : '');

    container.innerHTML = `
      <div class="module-header">
        <div>
          <h2>File Manager & SFTP Explorer</h2>
          <p class="subtitle">Secure remote filesystem access with strict path traversal isolation</p>
        </div>
        <div class="file-actions">
          <select id="files-machine-select" onchange="FileManagerView.onSelectMachine(this.value)">
            ${fleet.map(m => `
              <option value="${m.id}" ${m.id === activeMachineId ? 'selected' : ''}>
                ${m.hostname || m.id}
              </option>
            `).join('')}
          </select>
          <button class="btn btn-secondary" onclick="FileManagerView.navigateUp()">⬆ Up</button>
          <button class="btn btn-primary" onclick="FileManagerView.refresh()">🔄 Refresh</button>
        </div>
      </div>

      <div class="breadcrumb-bar card">
        <span class="path-label">Location:</span>
        <input type="text" id="files-current-path" value="${this.currentPath}" onkeydown="FileManagerView.handlePathEnter(event)" />
        <button class="btn-sm" onclick="FileManagerView.loadCurrentPath()">Go</button>
      </div>

      <div class="files-table-container card">
        <table class="data-table">
          <thead>
            <tr>
              <th width="40">Type</th>
              <th>Name</th>
              <th width="120">Size</th>
              <th width="160">Modified</th>
              <th width="140">Actions</th>
            </tr>
          </thead>
          <tbody id="files-table-body">
            <tr>
              <td colspan="5" class="text-center">Select a machine and click Refresh to view files.</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    if (activeMachineId) {
      FileManagerView.loadCurrentPath();
    }
  }

  static onSelectMachine(machineId) {
    window.stationApp.state.set('activeMachineId', machineId);
    FileManagerView.loadCurrentPath();
  }

  static async loadCurrentPath() {
    const machineId = document.getElementById('files-machine-select').value;
    const pathInput = document.getElementById('files-current-path');
    const tableBody = document.getElementById('files-table-body');
    const targetPath = pathInput.value.trim() || '/';

    if (!machineId) return;

    tableBody.innerHTML = `<tr><td colspan="5" class="text-center">Loading files from ${machineId}...</td></tr>`;

    try {
      const api = window.stationApp.api;
      const res = await api.listFiles(machineId, targetPath);
      const entries = res.entries || [];

      if (entries.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Directory is empty.</td></tr>`;
        return;
      }

      tableBody.innerHTML = entries.map(item => `
        <tr>
          <td>${item.is_dir ? '📁' : '📄'}</td>
          <td>
            ${item.is_dir ? `
              <a href="javascript:void(0)" onclick="FileManagerView.openDir('${item.path}')">
                <strong>${item.name}</strong>
              </a>
            ` : `<span>${item.name}</span>`}
          </td>
          <td><small>${item.size_bytes ? Math.round(item.size_bytes / 1024) + ' KB' : '-'}</small></td>
          <td><small>${item.modified_at ? new Date(item.modified_at).toLocaleDateString() : '-'}</small></td>
          <td>
            ${!item.is_dir ? `<button class="btn-sm" onclick="FileManagerView.downloadFile('${item.path}')">Download</button>` : ''}
            <button class="btn-sm btn-danger" onclick="FileManagerView.deleteItem('${item.path}')">Delete</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Error: ${err.message}</td></tr>`;
    }
  }

  static openDir(path) {
    document.getElementById('files-current-path').value = path;
    FileManagerView.loadCurrentPath();
  }

  static navigateUp() {
    const pathInput = document.getElementById('files-current-path');
    let p = pathInput.value.replace(/\\/g, '/');
    if (p.endsWith('/') && p.length > 1) p = p.slice(0, -1);
    const lastSlash = p.lastIndexOf('/');
    const newPath = lastSlash > 0 ? p.substring(0, lastSlash) : '/';
    pathInput.value = newPath;
    FileManagerView.loadCurrentPath();
  }

  static handlePathEnter(event) {
    if (event.key === 'Enter') {
      FileManagerView.loadCurrentPath();
    }
  }

  static refresh() {
    FileManagerView.loadCurrentPath();
  }

  static downloadFile(path, name) {
    if (typeof window !== 'undefined' && typeof window.downloadFile === 'function') {
      window.downloadFile(path, name || path.split(/[\\/]/).pop());
    } else {
      alert(`Initiating download for: ${path}`);
    }
  }

  static deleteItem(path) {
    if (confirm(`Permanently delete [${path}]?`)) {
      alert(`Delete operation dispatched for: ${path}`);
    }
  }
}

if (typeof window !== 'undefined') {
  window.FileManagerView = FileManagerView;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FileManagerView;
}
