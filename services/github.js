const config = require('../config');

const API_BASE = 'https://api.github.com';

function getHeaders() {
  return {
    'Authorization': `Bearer ${config.githubToken}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'TeveFlipe-DevBot',
    'Content-Type': 'application/json'
  };
}

async function githubFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...getHeaders(),
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    const errorText = await res.text();
    let errorJson;
    try {
      errorJson = JSON.parse(errorText);
    } catch {
      errorJson = { message: errorText };
    }
    const err = new Error(`GitHub API Error [${res.status}]: ${errorJson.message || res.statusText}`);
    err.status = res.status;
    err.details = errorJson;
    throw err;
  }

  // Si no hay contenido (como en 204 No Content para dispatches)
  if (res.status === 204) return null;

  return await res.json();
}

/**
 * Realiza un commit atómico de múltiples archivos usando la Git Data API.
 * @param {Array<{ path: string, content: string }>} files
 * @param {string} commitMessage
 */
async function commitFiles(files, commitMessage) {
  const owner = config.githubOwner;
  const repo = config.githubRepo;
  const branch = config.githubBranch;

  // 1. Obtener el SHA del commit actual en la rama
  const refData = await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  const parentCommitSha = refData.object.sha;

  // 2. Obtener el tree base del commit actual
  const parentCommit = await githubFetch(`/repos/${owner}/${repo}/git/commits/${parentCommitSha}`);
  const baseTreeSha = parentCommit.tree.sha;

  // 3. Crear los blobs para cada archivo
  const treeNodes = [];
  for (const file of files) {
    const blobData = await githubFetch(`/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({
        content: Buffer.from(file.content, 'utf-8').toString('base64'),
        encoding: 'base64'
      })
    });

    treeNodes.push({
      path: file.path.replace(/^\/+/, ''), // quitar barra inicial si existe
      mode: '100644',
      type: 'blob',
      sha: blobData.sha
    });
  }

  // 4. Crear un nuevo tree apuntando al tree base y agregando los nuevos blobs
  const newTree = await githubFetch(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeNodes
    })
  });

  // 5. Crear el nuevo commit
  const newCommit = await githubFetch(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: commitMessage,
      tree: newTree.sha,
      parents: [parentCommitSha]
    })
  });

  // 6. Actualizar la referencia del branch para que apunte al nuevo commit
  await githubFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({
      sha: newCommit.sha,
      force: false
    })
  });

  return {
    sha: newCommit.sha,
    url: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}`,
    message: commitMessage,
    filesCount: files.length
  };
}

/**
 * Dispara un workflow de GitHub Actions
 * @param {string|number} workflowId - Nombre de archivo (ej. sync_bot.yml) o ID numérico
 * @param {object} inputs - Parámetros de entrada opcionales
 */
async function triggerWorkflow(workflowId, inputs = {}) {
  const owner = config.githubOwner;
  const repo = config.githubRepo;
  const branch = config.githubBranch;

  // Extraer solo el nombre de archivo si viene con ruta (.github/workflows/foo.yml -> foo.yml)
  const cleanId = String(workflowId).split('/').pop();

  await githubFetch(`/repos/${owner}/${repo}/actions/workflows/${cleanId}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({
      ref: branch,
      inputs: inputs
    })
  });

  return {
    ok: true,
    workflow: cleanId,
    repo: `${owner}/${repo}`,
    branch: branch
  };
}

/**
 * Lista todos los workflows activos en el repositorio
 */
async function listWorkflows() {
  const owner = config.githubOwner;
  const repo = config.githubRepo;

  const data = await githubFetch(`/repos/${owner}/${repo}/actions/workflows?per_page=100`);
  return data.workflows.filter(w => w.state === 'active').map(w => ({
    id: w.id,
    name: w.name,
    path: w.path,
    filename: w.path.split('/').pop(),
    html_url: w.html_url
  }));
}

/**
 * Obtiene las ejecuciones más recientes de GitHub Actions
 */
async function getWorkflowRuns(limit = 5) {
  const owner = config.githubOwner;
  const repo = config.githubRepo;

  const data = await githubFetch(`/repos/${owner}/${repo}/actions/runs?per_page=${limit}`);
  return data.workflow_runs.map(r => ({
    id: r.id,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    created_at: r.created_at,
    html_url: r.html_url,
    event: r.event
  }));
}

/**
 * Obtiene el último commit de la rama principal
 */
async function getLatestCommit() {
  const owner = config.githubOwner;
  const repo = config.githubRepo;
  const branch = config.githubBranch;

  const data = await githubFetch(`/repos/${owner}/${repo}/commits?sha=${branch}&per_page=1`);
  if (!data || data.length === 0) return null;
  const c = data[0];
  return {
    sha: c.sha.substring(0, 7),
    fullSha: c.sha,
    message: c.commit.message,
    author: c.commit.author.name,
    date: c.commit.author.date,
    html_url: c.html_url
  };
}

module.exports = {
  commitFiles,
  triggerWorkflow,
  listWorkflows,
  getWorkflowRuns,
  getLatestCommit
};
