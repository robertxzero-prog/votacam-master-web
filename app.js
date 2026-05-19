const cfg = window.MASTER_CONFIG || {};

const state = {
  apiBase: cfg.apiBase || "http://localhost:3000",
  token: localStorage.getItem("master_auth_token") || "",
  user: null,
  camaras: [],
  editCodigo: null,
  saving: false,
  filters: {
    q: "",
    status: "TODOS",
    plano: "TODOS",
    uf: "TODOS",
  },
  page: 1,
  pageSize: 8,
  security: {
    codigo_instancia: "",
    novo_email: "",
    novo_nome: "",
    nova_senha: "",
  },
};

function fmtDate(v) {
  if (!v) return "-";
  return new Date(v).toLocaleString("pt-BR");
}

function el(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function ensureToastRoot() {
  let root = document.getElementById("toastRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "toastRoot";
    root.className = "toast-root";
    document.body.appendChild(root);
  }
  return root;
}

function showToast(message, type = "info", timeoutMs = 5200) {
  const root = ensureToastRoot();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  root.appendChild(toast);

  const remove = () => {
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 180);
  };
  setTimeout(remove, timeoutMs);
  toast.onclick = remove;
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const doFetch = () =>
    fetch(`${state.apiBase}${path}`, {
      ...options,
      headers,
    });

  let res = await doFetch();
  if (res.status === 401 && state.token && !options.__isRetry) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      headers.Authorization = `Bearer ${state.token}`;
      res = await fetch(`${state.apiBase}${path}`, {
        ...options,
        __isRetry: true,
        headers,
      });
    }
  }

  if (res.status === 401 && state.token) {
    logoutMaster();
    renderLogin();
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${txt || ""}`.trim());
  }
  return res.json();
}

async function tryRefreshToken() {
  try {
    const res = await fetch(`${state.apiBase}/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.token}`,
        "x-device-id": "master-web-local",
        "x-device-name": "master-web",
      },
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data?.token) return false;
    state.token = data.token;
    localStorage.setItem("master_auth_token", data.token);
    return true;
  } catch {
    return false;
  }
}

async function apiNoRetry(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`${state.apiBase}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${txt || ""}`.trim());
  }
  return res.json();
}

function showLoadingOverlay() {
  const node = el(`
    <div class="loading-overlay" id="loadingOverlay">
      <div class="loading-card">
        <h3>Inicializando SaaS Master</h3>
        <p id="loadingText" class="muted">Conectando com API central...</p>
        <div class="progress-track">
          <div class="progress-bar" id="progressBar"></div>
        </div>
        <div class="progress-row">
          <small class="muted">Carregando sistemas de câmara</small>
          <strong id="progressValue">0%</strong>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(node);
  return node;
}

async function runLoginTransition() {
  const overlay = showLoadingOverlay();
  const bar = overlay.querySelector("#progressBar");
  const text = overlay.querySelector("#loadingText");
  const value = overlay.querySelector("#progressValue");
  const steps = [
    { n: 18, t: "Validando credenciais..." },
    { n: 37, t: "Carregando módulos administrativos..." },
    { n: 61, t: "Sincronizando câmaras monitoradas..." },
    { n: 84, t: "Aplicando políticas de licença..." },
    { n: 100, t: "Pronto. Abrindo painel..." },
  ];
  for (const step of steps) {
    text.textContent = step.t;
    bar.style.width = `${step.n}%`;
    value.textContent = `${step.n}%`;
    await new Promise((r) => setTimeout(r, 220));
  }
  overlay.remove();
}

async function loginMaster(email, senha, twoFactorCode) {
  return apiNoRetry("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      senha,
      twoFactorCode: twoFactorCode || undefined,
      deviceName: "master-web",
      deviceId: "master-web-local",
    }),
  });
}

function logoutMaster() {
  localStorage.removeItem("master_auth_token");
  state.token = "";
  state.user = null;
}

function renderLogin() {
  const root = document.getElementById("app");
  root.innerHTML = "";
  const node = el(`
    <section class="login-shell">
      <div class="login-card">
        <div class="login-brand">Painel Corporativo</div>
        <h1>${cfg.appName || "SaaS Master"}</h1>
        <p class="muted">Gestão central de câmaras, planos, licenças e monitoramento.</p>
        <div class="grid">
          <input id="email" class="input" placeholder="E-mail ADMIN do master" />
          <input id="pass" class="input" type="password" placeholder="Senha" />
          <input id="twofa" class="input" type="text" placeholder="Código 2FA (se habilitado)" />
          <button id="btnLogin" class="btn btn-blue">Entrar</button>
          <small id="loginHint" class="muted">API: ${state.apiBase}</small>
        </div>
      </div>
    </section>
  `);
  root.appendChild(node);

  node.querySelector("#btnLogin").onclick = async () => {
    const email = node.querySelector("#email").value.trim();
    const senha = node.querySelector("#pass").value;
    const twofa = node.querySelector("#twofa").value.trim();
    const hint = node.querySelector("#loginHint");
    if (!email || !senha) {
      hint.textContent = "Informe e-mail e senha.";
      return;
    }
    hint.textContent = "Autenticando...";
    try {
      const data = await loginMaster(email, senha, twofa);
      if (data?.requires_2fa) {
        hint.textContent = "2FA obrigatório: informe o código e tente novamente.";
        return;
      }
      if (!data?.token || !data?.usuario) {
        hint.textContent = "Resposta de login inválida.";
        return;
      }
      if (data.usuario.role !== "ADMIN") {
        hint.textContent = "Acesso negado: somente ADMIN pode usar o SaaS Master.";
        return;
      }
      state.token = data.token;
      state.user = data.usuario;
      localStorage.setItem("master_auth_token", data.token);
      await runLoginTransition();
      await renderMaster();
    } catch (err) {
      hint.textContent = `Falha no login: ${err.message || err}`;
    }
  };
}

async function loadMe() {
  const data = await apiNoRetry("/auth/me", { method: "GET" });
  if (data?.role !== "ADMIN") throw new Error("Somente ADMIN pode acessar.");
  state.user = data;
}

async function loadCamaras() {
  const data = await api("/configuracao/camaras");
  state.camaras = (data.itens || []).filter((item) => (item.codigo_instancia || "").toLowerCase() !== "default");
}

async function upsertCamara(payload) {
  await api("/configuracao/camaras/upsert", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

async function gerarToken(codigoInstancia) {
  const data = await api("/configuracao/camaras/token", {
    method: "POST",
    body: JSON.stringify({ codigo_instancia: codigoInstancia }),
  });
  if (data?.monitor_token) {
    showToast(`Token ${data.codigo_instancia}: ${data.monitor_token}`, "info", 12000);
  }
}

async function revogarToken(codigoInstancia) {
  return api("/configuracao/camaras/token/revogar", {
    method: "POST",
    body: JSON.stringify({ codigo_instancia: codigoInstancia }),
  });
}

async function excluirCamara(codigoInstancia) {
  return api(`/configuracao/camaras/${encodeURIComponent(codigoInstancia)}`, {
    method: "DELETE",
  });
}

async function redefinirCredencialAdmin(codigoInstancia, payload) {
  return api("/configuracao/camaras/admin/redefinir-credencial", {
    method: "POST",
    body: JSON.stringify({
      codigo_instancia: codigoInstancia,
      novo_email: payload.novo_email || null,
      nova_senha: payload.nova_senha,
      novo_nome: payload.novo_nome || null,
    }),
  });
}

async function testarConexaoInstancia(item) {
  return api("/configuracao/camaras/testar-conexao", {
    method: "POST",
    body: JSON.stringify({ codigo_instancia: item?.codigo_instancia }),
  });
}

async function sincronizarLicencaInstanciaAgora(item) {
  return api("/configuracao/camaras/forcar-sync", {
    method: "POST",
    body: JSON.stringify({ codigo_instancia: item?.codigo_instancia }),
  });
}

async function logoutAllSessions() {
  return api("/auth/logout-all", { method: "POST" });
}

async function loadAuditoria(limite = 40) {
  return api(`/auditoria?limite=${encodeURIComponent(limite)}`, { method: "GET" });
}

function statusBadge(item) {
  const online = item.status_online === "ONLINE";
  const tone = online ? "green" : "red";
  return `<span class="signal-badge signal-${tone}"><span class="signal-icon" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${online ? "ONLINE" : "OFFLINE"}</span>`;
}

function licBadge(v) {
  const meta = {
    ATIVA: { label: "ATIVA", cls: "ok", color: "#22c55e", pulse: true },
    INADIMPLENTE: { label: "INADIMPLENTE", cls: "warn", color: "#f59e0b", pulse: false },
    BLOQUEADA: { label: "BLOQUEADA", cls: "danger", color: "#ef4444", pulse: false },
    TESTE: { label: "EM ANALISE", cls: "off", color: "#94a3b8", pulse: false },
  }[v || "TESTE"] || { label: "EM ANALISE", cls: "off", color: "#94a3b8", pulse: false };

  return `<span class="badge ${meta.cls}">${meta.label}</span>`;
}

function actionButtonClass(v) {
  if (v === "ATIVA") return "btn btn-green";
  if (v === "INADIMPLENTE") return "btn btn-amber";
  if (v === "BLOQUEADA") return "btn btn-red";
  return "btn btn-dark";
}

function unidadeLabel(v) {
  const u = (v || "DIAS").toUpperCase();
  if (u === "MESES") return "mês(es)";
  if (u === "ANOS") return "ano(s)";
  return "dia(s)";
}

function offlineWindowMs(item) {
  const valor = Math.max(1, Number(item.licenca_offline_valor || 30));
  const unidade = (item.licenca_offline_unidade || "DIAS").toUpperCase();
  if (unidade === "ANOS") return valor * 365 * 24 * 60 * 60 * 1000;
  if (unidade === "MESES") return valor * 30 * 24 * 60 * 60 * 1000;
  return valor * 24 * 60 * 60 * 1000;
}

function syncBadge(item) {
  const lastSyncRaw = item.licenca_ultimo_sync_em || item.atualizado_em;
  if (!lastSyncRaw) return `<span class="badge off">Sem sync</span>`;
  const now = Date.now();
  const lastSync = new Date(lastSyncRaw).getTime();
  const ttl = offlineWindowMs(item);
  const remainingMs = lastSync + ttl - now;
  const remainingDays = remainingMs / (24 * 60 * 60 * 1000);

  if (remainingMs <= 0) return `<span class="badge danger">Expirado</span>`;
  if (remainingDays <= 3) return `<span class="badge warn">Risco alto</span>`;
  if (remainingDays <= 7) return `<span class="badge warn">Atenção</span>`;
  return `<span class="badge ok">Sincronizado</span>`;
}

function syncRemainingText(item) {
  const lastSyncRaw = item.licenca_ultimo_sync_em || item.atualizado_em;
  if (!lastSyncRaw) return "-";
  const now = Date.now();
  const lastSync = new Date(lastSyncRaw).getTime();
  const ttl = offlineWindowMs(item);
  const remainingMs = Math.max(0, lastSync + ttl - now);
  const totalHours = Math.floor(remainingMs / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${days}d ${hours}h`;
}

function filtrarCamaras() {
  const q = state.filters.q.trim().toLowerCase();
  return state.camaras.filter((i) => {
    const matchesQ =
      !q ||
      i.nome_oficial?.toLowerCase().includes(q) ||
      i.codigo_instancia?.toLowerCase().includes(q) ||
      i.cidade?.toLowerCase().includes(q);
    const matchesStatus =
      state.filters.status === "TODOS" || i.status_online === state.filters.status;
    const matchesPlano =
      state.filters.plano === "TODOS" || (i.plano_nome || "Plano Basico") === state.filters.plano;
    const matchesUf = state.filters.uf === "TODOS" || (i.uf || "") === state.filters.uf;
    return matchesQ && matchesStatus && matchesPlano && matchesUf;
  });
}

function paginar(items) {
  const total = Math.max(1, Math.ceil(items.length / state.pageSize));
  if (state.page > total) state.page = total;
  const start = (state.page - 1) * state.pageSize;
  return {
    total,
    itens: items.slice(start, start + state.pageSize),
  };
}

async function renderMaster() {
  let auditoria = [];
  try {
    await loadCamaras();
    const aud = await loadAuditoria(30);
    auditoria = aud?.itens || [];
  } catch (err) {
    showToast(`Falha ao carregar dados do painel: ${err.message || err}`, "error");
    return;
  }
  const root = document.getElementById("app");
  root.innerHTML = "";
  const filtradas = filtrarCamaras();
  const { total, itens } = paginar(filtradas);
  const planos = Array.from(new Set(state.camaras.map((i) => i.plano_nome || "Plano Basico"))).sort();
  const ufs = Array.from(new Set(state.camaras.map((i) => i.uf).filter(Boolean))).sort();

  const node = el(`
    <div class="wrap grid">
      <div class="top">
        <div>
          <h1>${cfg.appName || "SaaS Master"}</h1>
          <p class="muted">Controle central de câmaras, monitoramento, plano e licença.</p>
          <small class="muted">Logado como: ${state.user?.nome || state.user?.email || "-"}</small>
        </div>
        <div class="row">
          <button id="openCamaraForm" class="btn btn-blue">Cadastrar câmara</button>
          <button id="refresh" class="btn btn-dark">Atualizar</button>
          <button id="openAudit" class="btn btn-dark">Auditoria</button>
          <button id="logoutAll" class="btn btn-amber">Encerrar todas as sessões</button>
          <button id="logout" class="btn btn-red">Sair</button>
        </div>
      </div>

      <section id="camaraFormCard" class="card hidden">
        <h3 id="formTitle">Cadastrar câmara</h3>
        <div class="grid grid-2">
          <input id="codigo" class="input" placeholder="Código da instância" />
          <input id="nome" class="input" placeholder="Nome oficial da câmara" />
          <input id="cidade" class="input" placeholder="Cidade" />
          <input id="uf" class="input" placeholder="UF" maxlength="2" />
          <input id="slug" class="input" placeholder="Slug (opcional)" />
          <input id="plano" class="input" placeholder="Plano (ex: Profissional)" value="Plano Basico" />
          <select id="licenca" class="select">
            <option value="TESTE">EM ANÁLISE</option>
            <option value="ATIVA">ATIVA</option>
            <option value="INADIMPLENTE">INADIMPLENTE</option>
            <option value="BLOQUEADA">BLOQUEADA</option>
          </select>
          <input id="offlineValor" class="input" type="number" min="1" step="1" placeholder="Janela offline (valor)" value="30" />
          <select id="offlineUnidade" class="select">
            <option value="DIAS">Dias</option>
            <option value="MESES">Mês</option>
            <option value="ANOS">Ano</option>
          </select>
        </div>
        <div class="row" style="margin-top:12px;">
          <button id="saveCamara" class="btn btn-blue">Salvar câmara</button>
          <button id="cancelEdit" class="btn btn-dark">Cancelar edição</button>
          <small id="formHint" class="muted"></small>
        </div>
      </section>

      <section class="card">
        <div class="row" style="justify-content:space-between;">
          <h3 style="margin:0;">Instâncias monitoradas</h3>
          <div class="row">
            <input id="filterQ" type="search" name="master_search_q_${Date.now()}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" class="input" placeholder="Buscar por nome/código/cidade" value="${state.filters.q}" />
            <select id="filterStatus" class="select">
              <option value="TODOS">Status: todos</option>
              <option value="ONLINE">Status: online</option>
              <option value="OFFLINE">Status: offline</option>
            </select>
            <select id="filterPlano" class="select">
              <option value="TODOS">Plano: todos</option>
              ${planos.map((p) => `<option value="${p}">${p}</option>`).join("")}
            </select>
            <select id="filterUf" class="select">
              <option value="TODOS">UF: todas</option>
              ${ufs.map((u) => `<option value="${u}">${u}</option>`).join("")}
            </select>
          </div>
        </div>
        <table class="instances-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Licenca</th>
              <th>Camara</th>
              <th>Codigo</th>
              <th>Plano</th>
              <th>Janela offline</th>
              <th>Sync licença</th>
              <th>Restante</th>
              <th>Heartbeat</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
        <div class="row" style="justify-content:space-between; margin-top:10px;">
          <small class="muted">Mostrando ${itens.length} de ${filtradas.length} resultado(s).</small>
          <div class="row">
            <button id="prevPage" class="btn btn-dark">Anterior</button>
            <small class="muted">Página ${state.page} de ${total}</small>
            <button id="nextPage" class="btn btn-dark">Próxima</button>
          </div>
        </div>
      </section>

      <div id="auditModal" class="audit-modal hidden">
        <div class="audit-backdrop" id="closeAuditBackdrop"></div>
        <section class="audit-panel card">
          <div class="row" style="justify-content:space-between;">
            <h3 style="margin:0;">Auditoria recente</h3>
            <button id="closeAudit" class="btn btn-dark">Fechar</button>
          </div>
          <div class="row" style="margin-top:8px;">
            <input id="auditFilter" class="input" placeholder="Filtrar por ação (ex: LOGIN, LICENCA, RESET)" />
          </div>
          <div style="max-height:60vh; overflow:auto; margin-top:10px;">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Ação</th>
                  <th>Entidade</th>
                  <th>Usuário</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody id="auditRows"></tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  `);
  root.appendChild(node);

  const filterStatus = node.querySelector("#filterStatus");
  const filterPlano = node.querySelector("#filterPlano");
  const filterUf = node.querySelector("#filterUf");
  const filterQ = node.querySelector("#filterQ");

  if (filterQ) {
    filterQ.setAttribute("name", "master_search_q");
    filterQ.setAttribute("autocomplete", "off");
    filterQ.setAttribute("autocapitalize", "off");
    filterQ.setAttribute("autocorrect", "off");
    filterQ.setAttribute("spellcheck", "false");
  }

  if (state.filters.q && state.filters.q.includes("@")) {
    state.filters.q = "";
    if (filterQ) filterQ.value = "";
  }

  const sanitizeSearchValue = () => {
    if (!filterQ) return;
    const raw = String(filterQ.value || "").trim();
    const loggedEmail = String(state.user?.email || "").trim().toLowerCase();
    const normalized = raw.toLowerCase();
    const looksLikeEmail = normalized.includes("@");
    const isLoggedUserEmail = !!loggedEmail && normalized === loggedEmail;
    if (looksLikeEmail || isLoggedUserEmail) {
      filterQ.value = "";
      state.filters.q = "";
    }
  };

  if (filterQ) {
    // Alguns navegadores preenchem após o paint; limpamos em sequência curta.
    window.setTimeout(sanitizeSearchValue, 0);
    window.setTimeout(sanitizeSearchValue, 120);
    window.setTimeout(sanitizeSearchValue, 300);
    filterQ.addEventListener("focus", sanitizeSearchValue);
    filterQ.addEventListener("change", sanitizeSearchValue);
  }

  filterStatus.value = state.filters.status;
  filterPlano.value = state.filters.plano;
  filterUf.value = state.filters.uf;

  node.querySelector("#logout").onclick = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {}
    logoutMaster();
    renderLogin();
  };
  node.querySelector("#refresh").onclick = () => renderMaster();
  const auditModal = node.querySelector("#auditModal");
  const openAuditBtn = node.querySelector("#openAudit");
  const closeAuditBtn = node.querySelector("#closeAudit");
  const closeAuditBackdrop = node.querySelector("#closeAuditBackdrop");
  const auditFilterInput = node.querySelector("#auditFilter");
  const openAudit = () => auditModal.classList.remove("hidden");
  const closeAudit = () => auditModal.classList.add("hidden");
  openAuditBtn.onclick = openAudit;
  closeAuditBtn.onclick = closeAudit;
  closeAuditBackdrop.onclick = closeAudit;
  node.querySelector("#logoutAll").onclick = async () => {
    const ok = confirm("Encerrar todas as sessões ativas do seu usuário ADMIN?");
    if (!ok) return;
    try {
      await logoutAllSessions();
      showToast("Sessões encerradas. Faça login novamente.", "success");
      logoutMaster();
      renderLogin();
    } catch (err) {
      showToast(`Erro ao encerrar sessões: ${err.message || err}`, "error");
    }
  };
  node.querySelector("#prevPage").onclick = () => {
    if (state.page > 1) state.page -= 1;
    renderMaster();
  };
  node.querySelector("#nextPage").onclick = () => {
    if (state.page < total) state.page += 1;
    renderMaster();
  };

  filterQ.oninput = (e) => {
    const value = String(e.target.value || "").trim();
    if (value.includes("@")) {
      e.target.value = "";
      state.filters.q = "";
      state.page = 1;
      renderMaster();
      return;
    }
    state.filters.q = value;
    state.page = 1;
    renderMaster();
  };
  filterStatus.onchange = (e) => {
    state.filters.status = e.target.value;
    state.page = 1;
    renderMaster();
  };
  filterPlano.onchange = (e) => {
    state.filters.plano = e.target.value;
    state.page = 1;
    renderMaster();
  };
  filterUf.onchange = (e) => {
    state.filters.uf = e.target.value;
    state.page = 1;
    renderMaster();
  };

  const formCard = node.querySelector("#camaraFormCard");
  const openCamaraFormBtn = node.querySelector("#openCamaraForm");
  const formTitle = node.querySelector("#formTitle");
  const codigoInput = node.querySelector("#codigo");
  const nomeInput = node.querySelector("#nome");
  const cidadeInput = node.querySelector("#cidade");
  const ufInput = node.querySelector("#uf");
  const slugInput = node.querySelector("#slug");
  const planoInput = node.querySelector("#plano");
  const licencaSelect = node.querySelector("#licenca");
  const offlineValorInput = node.querySelector("#offlineValor");
  const offlineUnidadeSelect = node.querySelector("#offlineUnidade");
  const cancelEditBtn = node.querySelector("#cancelEdit");
  const saveCamaraBtn = node.querySelector("#saveCamara");
  const formHint = node.querySelector("#formHint");

  function resetForm() {
    state.editCodigo = null;
    formTitle.textContent = "Cadastrar câmara";
    codigoInput.value = "";
    codigoInput.disabled = false;
    nomeInput.value = "";
    cidadeInput.value = "";
    ufInput.value = "";
    slugInput.value = "";
    planoInput.value = "Plano Basico";
    licencaSelect.value = "TESTE";
    offlineValorInput.value = "30";
    offlineUnidadeSelect.value = "DIAS";
    cancelEditBtn.style.display = "none";
    formCard.classList.add("hidden");
  }

  function fillForm(item) {
    state.editCodigo = item.codigo_instancia;
    formTitle.textContent = `Editar câmara: ${item.codigo_instancia}`;
    codigoInput.value = item.codigo_instancia || "";
    codigoInput.disabled = true;
    nomeInput.value = item.nome_oficial || "";
    cidadeInput.value = item.cidade || "";
    ufInput.value = item.uf || "";
    slugInput.value = item.tenant_slug || "";
    planoInput.value = item.plano_nome || "Plano Basico";
    licencaSelect.value = item.licenca_status || "TESTE";
    offlineValorInput.value = String(item.licenca_offline_valor || 30);
    offlineUnidadeSelect.value = item.licenca_offline_unidade || "DIAS";
    cancelEditBtn.style.display = "inline-flex";
    formCard.classList.remove("hidden");
  }

  openCamaraFormBtn.onclick = () => {
    resetForm();
    formCard.classList.remove("hidden");
    formTitle.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  cancelEditBtn.onclick = () => resetForm();
  resetForm();

  saveCamaraBtn.onclick = async () => {
    if (state.saving) return;
    const payload = {
      codigo_instancia: codigoInput.value.trim().toLowerCase(),
      nome_oficial: nomeInput.value.trim(),
      cidade: cidadeInput.value.trim() || null,
      uf: ufInput.value.trim() || null,
      tenant_slug: slugInput.value.trim() || null,
      plano_nome: planoInput.value.trim() || "Plano Basico",
      licenca_status: licencaSelect.value,
      licenca_offline_valor: Math.max(1, Number(offlineValorInput.value || 30)),
      licenca_offline_unidade: offlineUnidadeSelect.value || "DIAS",
    };
    if (!payload.codigo_instancia || !payload.nome_oficial) {
      showToast("Informe código e nome.", "warn");
      return;
    }
    try {
      state.saving = true;
      saveCamaraBtn.disabled = true;
      formHint.textContent = "Salvando...";
      await upsertCamara(payload);
      showToast(
        state.editCodigo ? "Câmara atualizada com sucesso." : "Câmara salva com sucesso.",
        "success",
      );
      resetForm();
      await renderMaster();
    } catch (err) {
      showToast(`Erro ao salvar câmara: ${err.message || err}`, "error");
    } finally {
      state.saving = false;
      saveCamaraBtn.disabled = false;
      formHint.textContent = "";
    }
  };

  const rows = node.querySelector("#rows");
  rows.innerHTML = "";
  for (const item of itens) {
    const tr = el(`
      <tr>
        <td>${statusBadge(item)}</td>
        <td>${licBadge(item.licenca_status)}</td>
        <td>${item.nome_oficial}</td>
        <td>${item.codigo_instancia}</td>
        <td>${item.plano_nome || "Plano Basico"}</td>
        <td>${item.licenca_offline_valor || 30} ${unidadeLabel(item.licenca_offline_unidade)}</td>
        <td>${syncBadge(item)}</td>
        <td>${syncRemainingText(item)}</td>
        <td>${fmtDate(item.ultimo_heartbeat_em)}</td>
        <td>
          <div class="row">
            <button class="btn btn-dark ping">Testar conexão</button>
            <button class="btn btn-dark syncNow">Forçar sync</button>
            <button class="btn edit">Editar</button>
            <select class="select quickStatus" style="min-width:140px;">
              <option value="ATIVA">ATIVA</option>
              <option value="INADIMPLENTE">INADIMPLENTE</option>
              <option value="BLOQUEADA">BLOQUEADA</option>
              <option value="TESTE">EM ANÁLISE</option>
            </select>
            <button class="${actionButtonClass(item.licenca_status)} applyStatus">Aplicar</button>
            ${item.codigo_instancia === "default" ? "" : '<button class="btn btn-red del">Excluir</button>'}
            <details class="adv-actions">
              <summary><span class="lock-icon" aria-hidden="true"></span>Avançado</summary>
              <div class="row adv-actions-row">
                <button class="btn btn-dark tok">Token</button>
                <button class="btn btn-amber revoke">Revogar token</button>
              </div>
            </details>
          </div>
        </td>
      </tr>
    `);
    tr.querySelector(".tok").onclick = async () => {
      try {
        await gerarToken(item.codigo_instancia);
      } catch (err) {
        showToast(`Erro ao gerar token: ${err.message || err}`, "error");
      }
    };
    tr.querySelector(".ping").onclick = async () => {
      try {
        const resp = await testarConexaoInstancia(item);
        if (!resp.ok) {
          showToast(
            `Instância "${item.codigo_instancia}": ${resp.mensagem}${
              resp.detalhe ? ` | ${resp.detalhe}` : ""
            }`,
            "warn",
            8000,
          );
          return;
        }
        showToast(
          `Instância "${item.codigo_instancia}": ${resp.mensagem}${
            resp.detalhe ? ` | ${resp.detalhe}` : ""
          }`,
          "success",
          8000,
        );
      } catch (err) {
        showToast(`Erro ao testar conexão: ${err.message || err}`, "error");
      }
    };
    tr.querySelector(".syncNow").onclick = async () => {
      try {
        const resp = await sincronizarLicencaInstanciaAgora(item);
        if (!resp.ok) {
          showToast(
            `Instância "${item.codigo_instancia}": ${resp.mensagem}${
              resp.detalhe ? ` | ${resp.detalhe}` : ""
            }`,
            "warn",
            8000,
          );
          return;
        }
        showToast(
          `Instância "${item.codigo_instancia}": ${resp.mensagem}${
            resp.detalhe ? ` | ${resp.detalhe}` : ""
          }`,
          "success",
          8000,
        );
        await renderMaster();
      } catch (err) {
        showToast(`Erro ao sincronizar instância: ${err.message || err}`, "error");
      }
    };
    tr.querySelector(".revoke").onclick = async () => {
      const ok = confirm(`Revogar token de monitoramento de "${item.codigo_instancia}"?`);
      if (!ok) return;
      try {
        const resp = await revogarToken(item.codigo_instancia);
        showToast(resp?.mensagem || "Token revogado.", "success");
      } catch (err) {
        showToast(`Erro ao revogar token: ${err.message || err}`, "error");
      }
    };
    tr.querySelector(".edit").onclick = () => {
      fillForm(item);
      formTitle.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    const quickStatus = tr.querySelector(".quickStatus");
    quickStatus.value = item.licenca_status || "TESTE";
    tr.querySelector(".applyStatus").onclick = async () => {
      try {
        await upsertCamara({ ...item, licenca_status: quickStatus.value });
        showToast("Licença atualizada com sucesso.", "success");
        await renderMaster();
      } catch (err) {
        showToast(`Erro ao atualizar licença: ${err.message || err}`, "error");
      }
    };
    const delBtn = tr.querySelector(".del");
    if (delBtn) {
      delBtn.onclick = async () => {
        const ok = confirm(`Tem certeza que deseja excluir a instância "${item.codigo_instancia}"?`);
        if (!ok) return;
        try {
          const resp = await excluirCamara(item.codigo_instancia);
          if (resp?.ok === false) {
            showToast(resp?.mensagem || "Não foi possível excluir.", "warn");
            return;
          }
          showToast("Instância excluída com sucesso.", "success");
          await renderMaster();
        } catch (err) {
          showToast(`Erro ao excluir instância: ${err.message || err}`, "error");
        }
      };
    }
    rows.appendChild(tr);
  }

  const auditRows = node.querySelector("#auditRows");
  const renderAuditRows = () => {
    const filtro = (auditFilterInput.value || "").trim().toLowerCase();
    const itensAuditoria = !filtro
      ? auditoria
      : auditoria.filter((ev) =>
          String(ev.acao || "").toLowerCase().includes(filtro),
        );

    auditRows.innerHTML = "";
    for (const ev of itensAuditoria) {
      const tr = el(`
        <tr>
          <td>${fmtDate(ev.criado_em)}</td>
          <td>${ev.acao || "-"}</td>
          <td>${ev.entidade || "-"}</td>
          <td>${ev.usuario_nome || ev.usuario_id || "-"}</td>
          <td>${ev.ip || "-"}</td>
        </tr>
      `);
      auditRows.appendChild(tr);
    }
  };
  renderAuditRows();
  auditFilterInput.oninput = renderAuditRows;

  const securityCard = el(`
    <section class="card">
      <details class="adv-actions security-advanced">
        <summary><span class="lock-icon"></span>Ações avançadas</summary>
        <div class="adv-actions-row security-panel">
          <h3>Segurança do Admin da Câmara</h3>
          <p class="muted" style="margin-top:-4px;">
            Redefina credenciais do administrador local da instância selecionada.
          </p>
          <small id="securityBackendHint" class="muted">Backend da instância: -</small>
          <div class="grid grid-2">
            <select id="securityCodigo" class="select"></select>
            <input id="securityEmail" class="input" placeholder="Novo e-mail (opcional)" />
            <input id="securityNome" class="input" placeholder="Novo nome (opcional)" />
            <input id="securitySenha" class="input" type="password" placeholder="Nova senha (mínimo 6)" />
          </div>
          <div class="row" style="margin-top:12px;">
            <button id="securityApply" class="btn btn-blue">Aplicar nova credencial</button>
            <small id="securityHint" class="muted"></small>
          </div>
        </div>
      </details>
    </section>
  `);
  root.querySelector(".wrap").insertBefore(securityCard, node.querySelector(".card:nth-of-type(3)"));

  const securityCodigo = securityCard.querySelector("#securityCodigo");
  const securityEmail = securityCard.querySelector("#securityEmail");
  const securityNome = securityCard.querySelector("#securityNome");
  const securitySenha = securityCard.querySelector("#securitySenha");
  const securityApply = securityCard.querySelector("#securityApply");
  const securityHint = securityCard.querySelector("#securityHint");
  const securityBackendHint = securityCard.querySelector("#securityBackendHint");

  securityCodigo.innerHTML = state.camaras
    .map(
      (cam) =>
        `<option value="${cam.codigo_instancia}">${cam.codigo_instancia} - ${cam.nome_oficial}</option>`,
    )
    .join("");

  if (!state.security.codigo_instancia && state.camaras.length) {
    state.security.codigo_instancia = state.camaras[0].codigo_instancia;
  }
  securityCodigo.value = state.security.codigo_instancia || "";
  securityEmail.value = state.security.novo_email || "";
  securityNome.value = state.security.novo_nome || "";
  securitySenha.value = "";

  function renderBackendHint() {
    const selected = state.camaras.find(
      (cam) => cam.codigo_instancia === (securityCodigo.value || "").trim(),
    );
    securityBackendHint.textContent = `Backend da instância: ${
      selected?.backend_url || "não configurado"
    }`;
  }

  securityCodigo.onchange = (e) => {
    state.security.codigo_instancia = e.target.value;
    renderBackendHint();
  };
  securityEmail.oninput = (e) => {
    state.security.novo_email = e.target.value;
  };
  securityNome.oninput = (e) => {
    state.security.novo_nome = e.target.value;
  };

  securityApply.onclick = async () => {
    const codigoInstancia = (securityCodigo.value || "").trim().toLowerCase();
    const novaSenha = (securitySenha.value || "").trim();
    if (!codigoInstancia) {
      securityHint.textContent = "Selecione uma instância.";
      return;
    }
    if (novaSenha.length < 6) {
      securityHint.textContent = "Informe uma nova senha com pelo menos 6 caracteres.";
      return;
    }
    const ok = confirm(`Aplicar nova credencial admin para "${codigoInstancia}"?`);
    if (!ok) return;

    try {
      securityApply.disabled = true;
      securityHint.textContent = "Aplicando...";
      const resp = await redefinirCredencialAdmin(codigoInstancia, {
        novo_email: (securityEmail.value || "").trim() || null,
        novo_nome: (securityNome.value || "").trim() || null,
        nova_senha: novaSenha,
      });
      if (resp?.ok === false) {
        securityHint.textContent = resp?.mensagem || "Falha ao redefinir credencial.";
        return;
      }
      securitySenha.value = "";
      state.security.nova_senha = "";
      securityHint.textContent = "Credencial atualizada com sucesso.";
      showToast(resp?.mensagem || "Credencial atualizada com sucesso.", "success");
    } catch (err) {
      securityHint.textContent = `Erro: ${err.message || err}`;
      showToast(`Erro ao atualizar credencial: ${err.message || err}`, "error");
    } finally {
      securityApply.disabled = false;
    }
  };

  renderBackendHint();

}

async function bootstrap() {
  if (!state.token) {
    renderLogin();
    return;
  }
  try {
    await loadMe();
    await renderMaster();
  } catch {
    logoutMaster();
    renderLogin();
  }
}

bootstrap().catch(() => renderLogin());

window.addEventListener("unhandledrejection", (event) => {
  showToast(
    `Erro inesperado: ${event.reason?.message || event.reason || "sem detalhe"}`,
    "error",
    10000,
  );
});
