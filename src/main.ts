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

  constructor() {
    this.store = new RecordStore("departure-canvas-v1", this.getSeeds());
    this.render();
    this.store.subscribe(() => this.render());
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

  private handleAdd() {
    const titleEl = document.getElementById("task-title") as HTMLInputElement;
    const catEl = document.getElementById("task-cat") as HTMLSelectElement;
    const dateEl = document.getElementById("task-date") as HTMLInputElement;
    const effEl = document.getElementById("task-eff") as HTMLInputElement;
    const impEl = document.getElementById("task-imp") as HTMLInputElement;
    const noteEl = document.getElementById("task-note") as HTMLTextAreaElement;
    const critEl = document.getElementById("task-crit") as HTMLInputElement;
    const depEl = document.getElementById("task-dep") as HTMLSelectElement;

    if (!titleEl.value.trim()) return;

    let dueDate = dateEl.value;
    const relative = parseRelativeDate(dueDate);
    if (relative) dueDate = relative;

    const dependsOn = depEl?.value && depEl.value !== "" ? depEl.value : undefined;

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
    };

    this.store.upsert(record);
    titleEl.value = "";
    noteEl.value = "";
  }

  private handleSearch(e: Event) {
    this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
    this.render();
  }

  private handleFilter(e: Event) {
    this.filterCategory = (e.target as HTMLSelectElement).value;
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

  private handleEdit(id: string) {
    const record = this.store.all().find(r => r.id === id);
    if (!record) return;

    const allRecords = this.store.all().filter(r => r.id !== id);
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal">
        <h2>Edit Task</h2>
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
          <label>Notes</label>
          <textarea id="edit-notes">${record.notes}</textarea>
        </div>
        <div class="field">
          <label>Depends On</label>
          <select id="edit-dep">
            <option value="">None</option>
            ${allRecords.map(r => `<option value="${r.id}" ${record.dependsOn === r.id ? 'selected' : ''}>${r.title}</option>`).join('')}
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
      const depId = depSelect.value || undefined;
      if (!depId) {
        if (warnEl) warnEl.style.display = "none";
        return;
      }
      const potentialRecord = { ...record, dependsOn: depId };
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
      const dependsOn = (document.getElementById("edit-dep") as HTMLSelectElement).value || undefined;
      const category = (document.getElementById("edit-cat") as HTMLSelectElement).value;
      const dueDate = (document.getElementById("edit-date") as HTMLInputElement).value;
      const effort = parseInt((document.getElementById("edit-eff") as HTMLInputElement).value) || 30;
      const impact = parseInt((document.getElementById("edit-imp") as HTMLInputElement).value) || 3;
      
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
        updatedAt: new Date().toISOString() 
      });
      document.body.removeChild(modal);
    };

    document.getElementById("edit-save")?.addEventListener("click", save);
    document.getElementById("edit-cancel")?.addEventListener("click", () => document.body.removeChild(modal));
  }

  private handleRemove(id: string) {
    if (confirm("Remove this task?")) this.store.remove(id);
  }

  private handleBatchRemove() {
    const doneIds = this.store.all().filter(r => r.status === "done").map(r => r.id);
    if (doneIds.length === 0) return;
    if (confirm(`Remove ${doneIds.length} completed tasks?`)) this.store.removeMany(doneIds);
  }

  private render() {
    const root = document.getElementById("app");
    if (!root) return;

    const records = this.store.all();
    const today = new Date().toISOString().split('T')[0];
    const plan = buildPlan(records, today);
    const summary = summarize(records, today);
    const week = suggestDailyLoad(records, 240, today);

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
            <label>Depends On</label>
            <select id="task-dep">
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
            <button class="ghost danger" id="btn-clear-done">Clear Done</button>
          </div>

          <div class="filter-group">
            <input type="text" id="search-input" placeholder="Search tasks..." value="${this.searchQuery}">
            <select id="filter-cat">
              <option value="All">All Categories</option>
              ${theme.categories.map(c => `<option value="${c}" ${this.filterCategory === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>

          <div class="task-list">
            ${this.renderTasks(plan)}
          </div>

          <div class="week-panel">
            <h3>Suggested 7-Day Outlook</h3>
            <div class="week">
              ${week.map((day, i) => `
                <div class="day ${day.overloaded ? 'over' : ''}">
                  <small>Day ${i + 1}</small>
                  <strong>${day.effort}m</strong>
                  <div class="day-tasks">
                    ${day.tasks.map(t => `<div class="day-task">${t.title}</div>`).join('')}
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
    document.getElementById("search-input")?.addEventListener("input", (e) => this.handleSearch(e));
    document.getElementById("filter-cat")?.addEventListener("change", (e) => this.handleFilter(e));
    
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
      const matchSearch = entry.item.title.toLowerCase().includes(this.searchQuery) || 
                          entry.item.notes.toLowerCase().includes(this.searchQuery);
      return matchCat && matchSearch;
    });

    if (filtered.length === 0) return `<div class="empty">No tasks found matching your criteria.</div>`;

    return filtered.map(entry => {
      const { item } = entry;
      const isOverdue = item.dueDate < new Date().toISOString().split('T')[0] && item.status !== "done";
      
      let blockWarning = "";
      if (item.dependsOn) {
        const depId = Array.isArray(item.dependsOn) ? item.dependsOn[0] : item.dependsOn;
        const depItem = allRecords.find(r => r.id === depId);
        if (depItem && depItem.status !== "done") {
          blockWarning = `<div class="badge blocked-badge">Blocked by: ${depItem.title}</div>`;
        }
      }

      const isCircular = hasCircularDependency(item, allRecords);
      if (isCircular) {
        blockWarning = `<div class="badge blocked-badge" style="background: #fecaca; color: #991b1b">Circular Dependency!</div>`;
      }

      return `
        <div class="record ${item.status === 'active' ? 'is-active' : ''} ${isOverdue ? 'is-overdue' : ''} ${item.impact >= 4 ? 'is-high-impact' : ''} ${item.isCritical ? 'is-critical' : ''}">
          <div>
            <div class="badge ${item.status === 'active' ? 'active-badge' : ''}">${item.status}</div>
            <div class="badge priority-badge">Score: ${entry.score.toFixed(1)}</div>
            <div class="badge">${item.category}</div>
            ${item.isCritical ? '<div class="badge critical-badge">Critical</div>' : ''}
            ${blockWarning}
            <h3 onclick="window.dispatchEvent(new CustomEvent('edit-task', {detail: '${item.id}'}))">${item.title}</h3>
            <div class="reasons">${entry.reasons.join(", ")}</div>
            <div class="editable-notes" contenteditable="true" onblur="window.dispatchEvent(new CustomEvent('update-note', {detail: {id: '${item.id}', note: this.innerText}}))">${item.notes}</div>
          </div>
          <div class="record-actions">
            <button class="ghost" onclick="window.dispatchEvent(new CustomEvent('toggle-task', {detail: '${item.id}'}))">✓</button>
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
window.addEventListener("update-note", (e: any) => {
  const { id, note } = e.detail;
  const records = (window as any).app?.store.all();
  const record = records.find((r: any) => r.id === id);
  if (record) (window as any).app?.store.upsert({ ...record, notes: note, updatedAt: new Date().toISOString() });
});

(window as any).app = new App();