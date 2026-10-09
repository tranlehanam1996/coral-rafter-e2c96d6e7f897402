import { RecordStore } from "./core/store";
import { buildPlan, summarize, suggestDailyLoad } from "./core/planner";
import { exportJson, exportCsv, importJson, download } from "./core/exchange";
import { theme } from "./theme";
import { revisionLedger } from "./generated/revision-ledger";
import type { LifeRecord, PlanEntry } from "./types";

const STORE_KEY = `departure_canvas_${theme.id}`;
const DAILY_CAPACITY = 60;

class App {
  private store: RecordStore;
  private currentRecords: readonly LifeRecord[] = [];
  private filterText = "";
  private filterProject = "";

  constructor() {
    this.store = new RecordStore(STORE_KEY, this.generateSeeds());
    this.store.subscribe((records) => {
      this.currentRecords = records;
      this.render();
    });
  }

  private generateSeeds(): LifeRecord[] {
    return theme.seeds.map(([title, category, effort, impact], i) => ({
      id: `seed-${i}`,
      title,
      category,
      effort,
      impact,
      status: "planned",
      dueDate: new Date().toISOString().split('T')[0],
      notes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }

  private handleAdd() {
    const id = crypto.randomUUID();
    const record: LifeRecord = {
      id,
      title: "New Task",
      category: theme.categories[0],
      dueDate: new Date().toISOString().split('T')[0],
      effort: 30,
      impact: 3,
      status: "planned",
      notes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.store.upsert(record);
  }

  private handleUpdate(id: string, updates: Partial<LifeRecord>) {
    const record = this.currentRecords.find(r => r.id === id);
    if (record) {
      this.store.upsert({ ...record, ...updates, updatedAt: new Date().toISOString() });
    }
  }

  private handleDelete(id: string) {
    if (confirm("Delete this task?")) this.store.remove(id);
  }

  private handleImport(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const records = importJson(ev.target?.result as string, theme);
        this.store.replace(records);
      } catch (err: any) {
        alert(err.message);
      }
    };
    reader.readAsText(file);
  }

  private render() {
    const root = document.getElementById("app");
    if (!root) return;

    const today = new Date().toISOString().split('T')[0];
    const plan = buildPlan(this.currentRecords, today);
    const summary = summarize(this.currentRecords, today);
    const week = suggestDailyLoad(plan.map(p => p.item), DAILY_CAPACITY, today);

    const filtered = this.currentRecords.filter(r => 
      (this.filterText === "" || r.title.toLowerCase().includes(this.filterText.toLowerCase())) &&
      (this.filterProject === "" || r.project?.toLowerCase().includes(this.filterProject.toLowerCase()))
    );

    root.innerHTML = `
      <header class="hero">
        <div>
          <div class="eyebrow">${theme.product}</div>
          <h1>${theme.product}</h1>
          <p>${theme.tagline}</p>
        </div>
        <div class="revision">
          <span>Revision</span>
          <strong>${revisionLedger.ordinal}</strong>
          <small>${revisionLedger.day}</small>
        </div>
      </header>

      <div class="summary">
        <article><span>Total Tasks</span><strong>${summary.total}</strong></article>
        <article><span>Effort (min)</span><strong>${summary.effort}</strong></article>
        <article><span>Overdue</span><strong class="danger">${summary.overdue}</strong></article>
        <article><span>Critical</strong><strong>${summary.criticalRemaining}</strong></article>
      </div>

      <div class="layout">
        <div class="panel">
          <div class="panel-title">
            <h2>${theme.itemLabel}s</h2>
            <button id="add-btn">+ New</button>
          </div>
          
          <div class="filter-group">
            <input type="text" id="search-input" placeholder="Search tasks..." value="${this.filterText}">
            <input type="text" id="project-input" placeholder="Filter project..." value="${this.filterProject}">
          </div>

          <div id="record-list">
            ${filtered.map(r => {
              const entry = plan.find(p => p.item.id === r.id);
              const isOverdue = r.status !== 'done' && r.dueDate < today;
              return `
                <div class="record ${r.status === 'active' ? 'is-active' : ''} ${isOverdue ? 'is-overdue' : ''} ${r.impact >= 4 ? 'is-high-impact' : ''}">
                  <div style="flex:1">
                    <h3 contenteditable="true" data-id="${r.id}" data-field="title">${r.title}</h3>
                    <div class="reasons">${entry?.reasons.join(", ") || "No priority factors"}</div>
                    <div style="margin-top: 0.5rem">
                      <span class="badge ${r.status === 'active' ? 'active-badge' : ''}">${r.status}</span>
                      <span class="badge priority-badge">Score: ${entry?.score || 0}</span>
                    </div>
                  </div>
                  <div class="record-actions">
                    <button class="ghost" data-id="${r.id}" data-action="toggle-status">✓</button>
                    <button class="danger" data-id="${r.id}" data-action="delete">✕</button>
                  </div>
                </div>
              `;
            }).join('')}
            ${filtered.length === 0 ? '<div class="empty">No tasks found.</div>' : ''}
          </div>

          <div class="exchange">
            <button id="exp-json">JSON</button>
            <button id="exp-csv">CSV</button>
            <label class="file">Import <input type="file" id="imp-json" accept=".json"></label>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">
            <h2>7-Day Forecast</h2>
            <small>${DAILY_CAPACITY}m / day capacity</small>
          </div>
          <div class="week-panel">
            <div class="week">
              ${week.map((day, i) => `
                <div class="day ${day.overloaded ? 'over' : ''}">
                  <span>Day ${i + 1}</span>
                  <strong>${day.effort}m</strong>
                  ${day.overloaded ? '<small class="overload-text">Overload!</small>' : ''}
                  <div class="day-tasks">
                    ${day.tasks.map(t => `<div class="day-task">${t.title}</div>`).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    this.attachEvents(root);
  }

  private attachEvents(root: HTMLElement) {
    root.querySelector("#add-btn")?.addEventListener("click", () => this.handleAdd());
    root.querySelector("#search-input")?.addEventListener("input", (e) => {
      this.filterText = (e.target as HTMLInputElement).value;
      this.render();
    });
    root.querySelector("#project-input")?.addEventListener("input", (e) => {
      this.filterProject = (e.target as HTMLInputElement).value;
      this.render();
    });
    root.querySelector("#exp-json")?.addEventListener("click", () => {
      download("backup.json", exportJson(this.currentRecords), "application/json");
    });
    root.querySelector("#exp-csv")?.addEventListener("click", () => {
      download("backup.csv", exportCsv(this.currentRecords), "text/csv");
    });
    root.querySelector("#imp-json")?.addEventListener("change", (e) => this.handleImport(e));

    root.querySelectorAll("[contenteditable=true]").forEach(el => {
      el.addEventListener("blur", () => {
        const id = el.getAttribute("data-id")!;
        const field = el.getAttribute("data-field") as keyof LifeRecord;
        this.handleUpdate(id, { [field]: el.textContent || "" });
      });
    });

    root.querySelectorAll("[data-action]").forEach(el => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-id")!;
        const action = el.getAttribute("data-action");
        if (action === "delete") this.handleDelete(id);
        if (action === "toggle-status") {
          const r = this.currentRecords.find(x => x.id === id);
          if (r) {
            const next: ItemStatus = r.status === "done" ? "planned" : "done";
            this.handleUpdate(id, { status: next });
          }
        }
      });
    });
  }
}

new App();
