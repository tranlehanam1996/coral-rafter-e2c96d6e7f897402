import { RecordStore } from "./core/store";
import { buildPlan, summarize, suggestDailyLoad, hasCircularDependency } from "./core/planner";
import { theme } from "./theme";
import { exportJson, exportCsv, importJson, download } from "./core/exchange";
import { parseRelativeDate } from "./core/date-utils";
import type { LifeRecord, ThemeConfig, PlanEntry } from "./types";
import { revisionLedger } from "./generated/revision-ledger";

class App {
  private store: RecordStore;
  private searchQuery = "";
  private filterCategory = "All";
  private filterProject = "All";
  private showArchived = false;
  
  private timerInterval: number | null = null;
  private timerSeconds = 0;
  private activeTimerTaskId: string | null = null;

  constructor() {
    this.store = new RecordStore("departure-canvas-v1", this.getSeeds());
    this.render();
    this.store.subscribe(() => this.render());
    this.setupKeyboardShortcuts();
  }

  private setupKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "n") {
          e.preventDefault();
          (document.getElementById("task-title") as HTMLInputElement)?.focus();
        }
      }
    });
  }

  private getSeeds(): LifeRecord[] {
    return theme.seeds.map(([title, category, effort, impact], i) => ({
      id: `seed-${i}`,
      title,
      category,
      effort,
      impact,
      dueDate: new Date().toISOString().split('T')[0],
      status: "planned",
      notes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }

  private handleTemplate(title: string, category: string, effort: number) {
    const titleEl = document.getElementById("task-title") as HTMLInputElement;
    const catEl = document.getElementById("task-cat") as HTMLSelectElement;
    const effEl = document.getElementById("task-eff") as HTMLInputElement;
    
    if (titleEl) titleEl.value = title;
    if (catEl) catEl.value = category;
    if (effEl) effEl.value = effort.toString();
    
    titleEl?.focus();
  }

  private handleAdd() {
    const titleEl = document.getElementById("task-title") as HTMLInputElement;
    const catEl = document.getElementById("task-cat") as HTMLSelectElement;
    const dateEl = document.getElementById("task-date") as HTMLInputElement;
    const effEl = document.getElementById("task-eff") as HTMLInputElement;
    const impEl = document.getElementById("task-imp") as HTMLInputElement;
    const noteEl = document.getElementById("task-note") as HTMLTextAreaElement;
    const critEl = document.getElementById("task-crit") as HTMLInputElement;
    const depEl = document.getElementById("task-dep") as HTMLSelectElement;
    const projEl = document.getElementById("task-proj") as HTMLInputElement;

    if (!titleEl.value.trim()) return;

    let dueDate = dateEl.value;
    const relative = parseRelativeDate(dueDate);
    if (relative) dueDate = relative;

    const selectedDeps = depEl ? Array.from(depEl.selectedOptions).map(opt => opt.value) : [];
    const dependsOn = selectedDeps.length > 0 ? selectedDeps : undefined;

    const record: LifeRecord = {
      id: crypto.randomUUID(),
      title: titleEl.value.trim(),
      category: catEl.value,
      dueDate,
      effort: parseInt(effEl.value) || 30,
      impact: parseInt(impEl.value) || 3,
      status: "planned",
      notes: noteEl.value,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isCritical: critEl?.checked || false,
      dependsOn,
      project: projEl?.value.trim() || undefined,
    };

    this.store.upsert(record);
    titleEl.value = "";
    noteEl.value = "";
    if (projEl) projEl.value = "";
  }

  private handleSearch(e: Event) {
    this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
    this.render();
  }

  private handleFilter(e: Event) {
    const target = e.target as HTMLSelectElement;
    if (target.id === "filter-cat") this.filterCategory = target.value;
    if (target.id === "filter-proj") this.filterProject = target.value;
    if (target.id === "filter-archived") this.showArchived = target.value === "true";
    this.render();
  }

  private handleToggleStatus(id: string) {
    const records = this.store.all();
    const record = records.find(r => r.id === id);
    if (!record) return;

    const statuses: LifeRecord["status"][] = ["planned", "active", "done"];
    const next = statuses[(statuses.indexOf(record.status) + 1) % statuses.length];
    
    this.store.upsert({ ...record, status: next, updatedAt: new Date().toISOString() });
  }

  private handleArchive(id: string) {
    const records = this.store.all();
    const record = records.find(r => r.id === id);
    if (!record) return;
    this.store.upsert({ ...record, status: "archived", updatedAt: new Date().toISOString() });
  }

  private handleBulkComplete() {
    const records = this.store.all();
    const today = new Date().toISOString().split('T')[0];
    const plan = buildPlan(records, today);
    const filtered = plan.filter(entry => {
      const matchCat = this.filterCategory === "All" || entry.item.category === this.filterCategory;
      const matchProj = this.filterProject === "All" || entry.item.project === this.filterProject;
      const matchSearch = entry.item.title.toLowerCase().includes(this.searchQuery) || 
                          entry.item.notes.toLowerCase().includes(this.searchQuery);
      return matchCat && matchProj && matchSearch;
    });

    if (filtered.length === 0) return;
    if (confirm(`Mark ${filtered.length} tasks as done?`)) {
      filtered.forEach(entry => {
        this.store.upsert({ ...entry.item, status: "done", updatedAt: new Date().toISOString() });
      });
    }
  }

  private handleEdit(id: string) {
    const record = this.store.all().find(r => r.id === id);
    if (!record) return;

    const allRecords = this.store.all().filter(r => r.id !== id);
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    
    const currentDeps = Array.isArray(record.dependsOn) ? record.dependsOn : (record.dependsOn ? [record.dependsOn] : []);

    modal.innerHTML = `
      <div class="modal">
        <h2 style="display:flex; justify-content:space-between; align-items:center">
          Edit Task
          <button class="ghost" style="font-size:1.5rem; padding:0; width:auto" id="edit-close">✕</button>
        </h2>
        <div class="field">
          <label>Title</label>
          <input id="edit-title" value="${record.title}">
        </div>
        <div class="form-grid">
          <div class="field">
            <label>${theme.dateLabel}</label>
            <input type="date" id="edit-date" value="${record.dueDate}">
          </div>
          <div class="field">
            <label>Category</label>
            <select id="edit-cat">
              ${theme.categories.map(c => `<option value="${c}" ${record.category === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-grid">
          <div class="field">
            <label>${theme.effortLabel}</label>
            <input type="number" id="edit-eff" value="${record.effort}">
          </div>
          <div class="field">
            <label>${theme.impactLabel}</label>
            <input type="number" id="edit-imp" value="${record.impact}" min="1" max="5">
          </div>
        </div>
        <div class="field">
          <label>Project</label>
          <input id="edit-proj" value="${record.project || ''}">
        </div>
        <div class="field">
          <label>Notes</label>
          <textarea id="edit-notes">${record.notes}</textarea>
        </div>
        <div class="field">
          <label>Depends On (Hold Ctrl/Cmd to select multiple)</label>
          <select id="edit-dep" multiple style="height: 100px">
            ${allRecords.map(r => `<option value="${r.id}" ${currentDeps.includes(r.id) ? 'selected' : ''}>${r.title}</option>`).join('')}
          </select>
        </div>
        <div id="circular-warning" style="color: #b91c1c; font-size: .8rem; font-weight: 700; margin-bottom: 1rem; display: none">⚠️ This dependency creates a circular reference!</div>
        <div class="field">
          <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer">
            <input type="checkbox" id="edit-critical" style="width: auto" ${record.isCritical ? 'checked' : ''}>
            Mark as Critical
          </label>
        </div>
        <div class="modal-actions">
          <button class="ghost" id="edit-cancel">Cancel</button>
          <button id="edit-save">Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const depSelect = document.getElementById("edit-dep") as HTMLSelectElement;
    const warnEl = document.getElementById("circular-warning");
    
    const updateCircularWarning = () => {
      const selectedDeps = Array.from(depSelect.selectedOptions).map(opt => opt.value);
      if (selectedDeps.length === 0) {
        if (warnEl) warnEl.style.display = "none";
        return;
      }
      const potentialRecord = { ...record, dependsOn: selectedDeps };
      const allWithPotential = [...allRecords, potentialRecord];
      const isCircular = hasCircularDependency(potentialRecord, allWithPotential);
      if (warnEl) warnEl.style.display = isCircular ? "block" : "none";
    };

    depSelect?.addEventListener("change", updateCircularWarning);
    updateCircularWarning();

    const save = () => {
      const title = (document.getElementById("edit-title") as HTMLInputElement).value;
      const notes = (document.getElementById("edit-notes") as HTMLTextAreaElement).value;
      const isCritical = (document.getElementById("edit-critical") as HTMLInputElement).checked;
      const selectedDeps = Array.from(depSelect.selectedOptions).map(opt => opt.value);
      const dependsOn = selectedDeps.length > 0 ? selectedDeps : undefined;
      const category = (document.getElementById("edit-cat") as HTMLSelectElement).value;
      const dueDate = (document.getElementById("edit-date") as HTMLInputElement).value;
      const effort = parseInt((document.getElementById("edit-eff") as HTMLInputElement).value) || 30;
      const impact = parseInt((document.getElementById("edit-imp") as HTMLInputElement).value) || 3;
      const project = (document.getElementById("edit-proj") as HTMLInputElement).value.trim() || undefined;
      
      this.store.upsert({ 
        ...record, 
        title: title.trim(), 
        notes, 
        isCritical, 
        dependsOn, 
        category, 
        dueDate, 
        effort, 
        impact, 
        project,
        updatedAt: new Date().toISOString() 
      });
      document.body.removeChild(modal);
    };

    document.getElementById("edit-save")?.addEventListener("click", save);
    document.getElementById("edit-cancel")?.addEventListener("click", () => document.body.removeChild(modal));
    document.getElementById("edit-close")?.addEventListener("click", () => document.body.removeChild(modal));
    (document.getElementById("edit-title") as HTMLInputElement)?.focus();
  }

  private handleRemove(id: string) {
    if (confirm("Remove this task?")) this.store.remove(id);
  }

  private handleBatchRemove() {
    const doneIds = this.store.all().filter(r => r.status === "done").map(r => r.id);
    if (doneIds.length === 0) return;
    if (confirm(`Remove ${doneIds.length} completed tasks?`)) this.store.removeMany(doneIds);
  }

  private handleClearAll() {
    if (confirm("Are you sure you want to delete ALL tasks? This cannot be undone.")) {
      this.store.replace([]);
    }
  }

  private startFocusSession(id: string) {
    if (this.timerInterval) this.stopFocusSession();
    
    const record = this.store.all().find(r => r.id === id);
    if (!record) return;

    this.activeTimerTaskId = id;
    this.timerSeconds = 0;
    this.timerInterval = window.setInterval(() => {
      this.timerSeconds++;
      this.render();
    }, 1000);
    
    this.store.upsert({ ...record, status: "active", updatedAt: new Date().toISOString() });
    this.render();
  }

  private stopFocusSession() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.activeTimerTaskId = null;
    this.timerSeconds = 0;
    this.render();
  }

  private formatTimer(s: number): string {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  private render() {
    const root = document.getElementById("app");
    if (!root) return;

    const records = this.store.all();
    const today = new Date().toISOString().split('T')[0];
    const plan = buildPlan(records, today);
    const summary = summarize(records, today);
    
    const projects = Array.from(new Set(records.map(r => r.project).filter(Boolean))) as string[];

    const filteredForOutlook = records.filter(r => {
      const matchCat = this.filterCategory === "All" || r.category === this.filterCategory;
      const matchProj = this.filterProject === "All" || r.project === this.filterProject;
      const matchSearch = r.title.toLowerCase().includes(this.searchQuery) || 
                          r.notes.toLowerCase().includes(this.searchQuery);
      return matchCat && matchProj && matchSearch;
    });
    const week = suggestDailyLoad(filteredForOutlook, 240, today);

    root.innerHTML = `
      <header class="hero">
        <div>
          <div class="eyebrow">${theme.product}</div>
          <h1>${theme.tagline}</h1>
          <p>Strategic trip preparation with dependency tracking.</p>
        </div>
        <div class="revision">
          <span>Revision</span>
          <strong>${revisionLedger.ordinal}</strong>
          <small>${revisionLedger.revision.slice(0, 8)}</small>
        </div>
      </header>

      ${this.activeTimerTaskId ? `
        <div class="focus-bar">
          <div class="focus-info">
            <span>Focusing on: <strong>${records.find(r => r.id === this.activeTimerTaskId)?.title}</strong></span>
            <span class="timer-display">${this.formatTimer(this.timerSeconds)}</span>
          </div>
          <button class="ghost" id="btn-stop-focus">Stop Session</button>
        </div>
      ` : ''}

      <section class="summary">
        <article><span>Total</span><strong>${summary.total}</strong></article>
        <article><span>Completed</span><strong>${summary.completed}</strong></article>
        <article><span>Overdue</span><strong>${summary.overdue}</strong></article>
        <article><span>Remaining Effort</span><strong>${summary.effort}m</strong></article>
      </section>

      <div class="layout">
        <aside class="panel">
          <div class="panel-title">
            <h2>Add ${theme.itemLabel}</h2>
          </div>
          <div class="field">
            <label>Title</label>
            <input id="task-title" placeholder="e.g. Renew Passport">
          </div>
          <div class="form-grid">
            <div class="field">
              <label>${theme.dateLabel}</label>
              <input id="task-date" type="date" value="${today}">
            </div>
            <div class="field">
              <label>Category</label>
              <select id="task-cat">
                ${theme.categories.map(c => `<option value="${c}">${c}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-grid">
            <div class="field">
              <label>${theme.effortLabel}</label>
              <input id="task-eff" type="number" value="30">
            </div>
            <div class="field">
              <label>${theme.impactLabel}</label>
              <input id="task-imp" type="number" value="3" min="1" max="5">
            </div>
          </div>
          <div class="field">
            <label>Project</label>
            <input id="task-proj" placeholder="e.g. Japan 2025">
          </div>
          <div class="field">
            <label>Depends On (Hold Ctrl/Cmd to select multiple)</label>
            <select id="task-dep" multiple style="height: 100px">
              <option value="">None</option>
              ${records.map(r => `<option value="${r.id}">${r.title}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer">
              <input type="checkbox" id="task-crit" style="width: auto">
              Critical Path
            </label>
          </div>
          <div class="field">
            <label>Notes</label>
            <textarea id="task-note"></textarea>
          </div>
          <button id="btn-add" style="width:100%">Create Task</button>
          
          <div style="margin-top: 1.5rem; border-top: 1px solid #dce7e1; padding-top: 1rem">
            <label style="margin-bottom: 0.5rem">Quick templates</label>
            <div style="display: flex; flex-wrap: wrap; gap: 0.4rem">
              <button class="ghost" style="font-size: 0.7rem; padding: 0.4rem 0.6rem" onclick="window.dispatchEvent(new CustomEvent('tpl', {detail: {t: 'Check Passport', c: 'Documents', e: 10}}))">Passport</button>
              <button class="ghost" style="font-size: 0.7rem; padding: 0.4rem 0.6rem" onclick="window.dispatchEvent(new CustomEvent('tpl', {detail: {t: 'Pack Toiletry Bag', c: 'Packing', e: 20}}))">Packing</button>
              <button class="ghost" style="font-size: 0.7rem; padding: 0.4rem 0.6rem" onclick="window.dispatchEvent(new CustomEvent('tpl', {detail: {t: 'Book Transit', c: 'Transport', e: 30}}))">Transit</button>
              <button class="ghost" style="font-size: 0.7rem; padding: 0.4rem 0.6rem" onclick="window.dispatchEvent(new CustomEvent('tpl', {detail: {t: 'Health Insurance', c: 'Health', e: 45}}))">Health</button>
            </div>
          </div>

          <div class="exchange">
            <button class="ghost" id="btn-export-json">JSON</button>
            <button class="ghost" id="btn-export-csv">CSV</button>
            <label class="file">
              Import
              <input type="file" id="import-file" accept=".json">
            </label>
          </div>
        </aside>

        <main class="panel">
          <div class="panel-title">
            <h2>${theme.product} Plan</h2>
            <div class="panel-actions" style="display: flex; gap: 0.5rem">
              <button class="ghost" id="btn-bulk-done">Complete Filtered</button>
              <button class="ghost danger" id="btn-clear-done">Clear Done</button>
              <button class="danger" id="btn-clear-all">Clear All</button>
            </div>
          </div>

          <div class="filter-group">
            <input type="text" id="search-input" placeholder="Search tasks..." value="${this.searchQuery}">
            <select id="filter-cat">
              <option value="All">All Categories</option>
              ${theme.categories.map(c => `<option value="${c}" ${this.filterCategory === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
            <select id="filter-proj">
              <option value="All">All Projects</option>
              ${projects.map(p => `<option value="${p}" ${this.filterProject === p ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
            <select id="filter-archived">
              <option value="false" ${!this.showArchived ? 'selected' : ''}>Active Only</option>
              <option value="true" ${this.showArchived ? 'selected' : ''}>Include Archived</option>
            </select>
          </div>

          <div class="task-list">
            ${this.renderTasks(plan)}
          </div>

          <div class="week-panel">
            <h3 style="margin-bottom: 0.5rem">Suggested 7-Day Outlook</h3>
            <div class="week">
              ${week.map((day, i) => `
                <div class="day ${day.overloaded ? 'over' : ''}">
                  <small>Day ${i + 1}</small>
                  <strong>${day.effort}m</strong>
                  <div class="day-tasks">
                    ${day.tasks.map(t => `<div class="day-task ${t.isCritical ? 'is-critical-outlook' : ''}">${t.isCritical ? '★ ' : ''}${t.title}</div>`).join('')}
                  </div>
                  ${day.overloaded ? '<div class="overload-text">Overload!</div>' : ''}
                </div>
              `).join('')}
            </div>
          </div>
        </main>
      </div>
    `;

    document.getElementById("btn-add")?.addEventListener("click", () => this.handleAdd());
    document.getElementById("btn-export-json")?.addEventListener("click", () => download("backup.json", exportJson(records), "application/json"));
    document.getElementById("btn-export-csv")?.addEventListener("click", () => download("backup.csv", exportCsv(records), "text/csv"));
    document.getElementById("btn-clear-done")?.addEventListener("click", () => this.handleBatchRemove());
    document.getElementById("btn-clear-all")?.addEventListener("click", () => this.handleClearAll());
    document.getElementById("btn-bulk-done")?.addEventListener("click", () => this.handleBulkComplete());
    document.getElementById("search-input")?.addEventListener("input", (e) => this.handleSearch(e));
    document.getElementById("filter-cat")?.addEventListener("change", (e) => this.handleFilter(e));
    document.getElementById("filter-proj")?.addEventListener("change", (e) => this.handleFilter(e));
    document.getElementById("filter-archived")?.addEventListener("change", (e) => this.handleFilter(e));
    document.getElementById("btn-stop-focus")?.addEventListener("click", () => this.stopFocusSession());
    
    const fileInput = document.getElementById("import-file") as HTMLInputElement;
    fileInput?.addEventListener("change", (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const imported = importJson(ev.target?.result as string, theme);
          this.store.replace(imported);
        } catch (err: any) {
          alert(err.message);
        }
      };
      reader.readAsText(file);
    });
  }

  private renderTasks(plan: PlanEntry[]) {
    const allRecords = this.store.all();
    const filtered = plan.filter(entry => {
      const matchCat = this.filterCategory === "All" || entry.item.category === this.filterCategory;
      const matchProj = this.filterProject === "All" || entry.item.project === this.filterProject;
      const matchSearch = entry.item.title.toLowerCase().includes(this.searchQuery) || 
                          entry.item.notes.toLowerCase().includes(this.searchQuery);
      return matchCat && matchProj && matchSearch;
    });

    if (this.showArchived) {
      const archived = allRecords.filter(r => r.status === "archived").map(item => ({
        item,
        score: 0,
        reasons: ["Archived"],
        daysUntilDue: 0
      }));
      
      const filteredArchived = archived.filter(entry => {
        const matchCat = this.filterCategory === "All" || entry.item.category === this.filterCategory;
        const matchProj = this.filterProject === "All" || entry.item.project === this.filterProject;
        const matchSearch = entry.item.title.toLowerCase().includes(this.searchQuery) || 
                            entry.item.notes.toLowerCase().includes(this.searchQuery);
        return matchCat && matchProj && matchSearch;
      });
      
      return `
        <div class="task-list-active">
          ${this.renderTaskItems(filtered)}
        </div>
        <div class="task-list-archived" style="margin-top: 2rem; border-top: 2px dashed #cbdad3; padding-top: 1rem">
          <h3 style="color: #668078; font-size: 0.9rem; text-transform: uppercase; margin-bottom: 1rem">Archived Tasks</h3>
          ${this.renderTaskItems(filteredArchived)}
        </div>
      `;
    }

    if (filtered.length === 0) return `<div class="empty">No tasks found matching your criteria. Try adjusting your search or category filter.</div>`;

    return this.renderTaskItems(filtered);
  }

  private renderTaskItems(entries: PlanEntry[]) {
    if (entries.length === 0) return `<div class="empty">No tasks found.</div>`;
    const allRecords = this.store.all();
    return entries.map(entry => {
      const { item } = entry;
      const isOverdue = item.dueDate < new Date().toISOString().split('T')[0] && item.status !== "done" && item.status !== "archived";
      
      let blockWarning = "";
      let isBlocked = false;
      if (item.dependsOn && item.status !== "archived") {
        const depIds = Array.isArray(item.dependsOn) ? item.dependsOn : [item.dependsOn];
        const blocking = depIds.map(id => allRecords.find(r => r.id === id)).filter(r => r && r.status !== "done");
        if (blocking.length > 0) {
          blockWarning = `<div class="badge blocked-badge">Blocked by: ${blocking.map(b => b!.title).join(", ")}</div>`;
          isBlocked = true;
        }
      }

      const isCircular = hasCircularDependency(item, allRecords);
      if (isCircular) {
        blockWarning = `<div class="badge blocked-badge" style="background: #fecaca; color: #991b1b">Circular Dependency!</div>`;
        isBlocked = true;
      }

      return `
        <div class="record ${item.status === 'active' ? 'is-active' : ''} ${isOverdue ? 'is-overdue' : ''} ${item.impact >= 4 ? 'is-high-impact' : ''} ${item.isCritical ? 'is-critical' : ''} ${isBlocked ? 'is-blocked' : ''} ${item.status === 'archived' ? 'is-archived' : ''}">
          <div>
            <div class="badge ${item.status === 'active' ? 'active-badge' : ''}">${item.status}</div>
            ${item.status !== 'archived' ? `<div class="badge priority-badge">Score: ${entry.score.toFixed(1)}</div>` : ''}
            <div class="badge">${item.category}</div>
            ${item.project ? `<div class="badge" style="background: #dcfce7; color: #166534">${item.project}</div>` : ''}
            ${item.isCritical ? '<div class="badge critical-badge">Critical</div>' : ''}
            ${blockWarning}
            <h3 tabindex="0" role="button" onclick="window.dispatchEvent(new CustomEvent('edit-task', {detail: '${item.id}'}))" onkeydown="if(event.key==='Enter') window.dispatchEvent(new CustomEvent('edit-task', {detail: '${item.id}'}))">${item.title}</h3>
            <div class="reasons">${entry.reasons.join(", ")}</div>
            <div class="editable-notes" contenteditable="true" onblur="window.dispatchEvent(new CustomEvent('update-note', {detail: {id: '${item.id}', note: this.innerText}}))">${item.notes}</div>
          </div>
          <div class="record-actions">
            <button class="ghost" onclick="window.dispatchEvent(new CustomEvent('toggle-task', {detail: '${item.id}'}))">✓</button>
            <button class="ghost" onclick="window.dispatchEvent(new CustomEvent('archive-task', {detail: '${item.id}'}))">📦</button>
            <button class="danger" onclick="window.dispatchEvent(new CustomEvent('remove-task', {detail: '${item.id}'}))">✕</button>
          </div>
        </div>
      `;
    }).join('');
  }
}

window.addEventListener("toggle-task", (e: any) => (window as any).app?.handleToggleStatus(e.detail));
window.addEventListener("remove-task", (e: any) => (window as any).app?.handleRemove(e.detail));
window.addEventListener("edit-task", (e: any) => (window as any).app?.handleEdit(e.detail));
window.addEventListener("focus-task", (e: any) => (window as any).app?.startFocusSession(e.detail));
window.addEventListener("archive-task", (e: any) => (window as any).app?.handleArchive(e.detail));
window.addEventListener("tpl", (e: any) => (window as any).app?.handleTemplate(e.detail.t, e.detail.c, e.detail.e));
window.addEventListener("update-note", (e: any) => {
  const { id, note } = e.detail;
  const records = (window as any).app?.store.all();
  const record = records.find((r: any) => r.id === id);
  if (record) (window as any).app?.store.upsert({ ...record, notes: note, updatedAt: new Date().toISOString() });
});

(window as any).app = new App();