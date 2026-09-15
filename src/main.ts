import "./style.css";
import { exportCsv, exportJson, importJson, download } from "./core/exchange";
import { buildPlan, localDay, suggestDailyLoad, summarize, validateRecord } from "./core/planner";
import { RecordStore } from "./core/store";
import { revisionLedger } from "./generated/revision-ledger";
import { theme } from "./theme";
import type { ItemStatus, LifeRecord } from "./types";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Application root is missing.");

const offsetDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const getSeeds = (): LifeRecord[] => theme.seeds.map(([title, category, effort, impact], index) => ({
  id: crypto.randomUUID(), title, category, effort, impact,
  dueDate: offsetDay(index + 1), status: index === 0 ? "active" : "planned", notes: "",
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}));
const store = new RecordStore(`life-board:${theme.id}:v1`, getSeeds());
let selectedCategory = "all";
let searchQuery = "";

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};
const escapeHtml = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (character) => HTML_ENTITIES[character] ?? character);

root.innerHTML = `
  <header class="hero"><div><span class="eyebrow">Local-first planning studio</span><h1>${theme.product}</h1>
    <p>${theme.tagline}</p></div><div class="revision" title="Repository revision ledger">
    <span>revision</span><strong>${revisionLedger.ordinal}</strong><small>${revisionLedger.day}</small></div></header>
  <section id="summary" class="summary"></section>
  <main class="layout"><section class="panel"><div class="panel-title"><h2>Add ${theme.itemLabel.toLowerCase()}</h2><button id="seed-export" class="ghost">Export JSON</button></div><form id="record-form" novalidate>
    <label>Title<input name="title" maxlength="100" required placeholder="Quick add... (Enter to save)"></label>
    <div class="form-grid"><label>Category<select name="category">${theme.categories.map((x) => `<option>${x}</option>`).join("")}</select></label>
    <label>${theme.dateLabel}<input name="dueDate" type="date" value="${localDay()}" required></label>
    <label>${theme.effortLabel}<input name="effort" type="number" min="1" max="480" value="30" required></label>
    <label>${theme.impactLabel}<input name="impact" type="number" min="1" max="5" value="3" required></label></div>
    <label>Notes<textarea name="notes" rows="3" maxlength="600"></textarea></label><p id="errors" class="errors"></p>
    <button type="submit">Add to plan</button></form><div class="exchange"><button id="csv" class="ghost">Export CSV</button>
    <label class="file">Import JSON<input id="import" type="file" accept="application/json"></label></div></section>
  <section class="panel plan-panel"><div class="panel-title"><h2>Priority plan</h2><div class="filter-group"><input id="search" type="text" placeholder="Search tasks..." style="width: 160px"><select id="filter"><option value="all">All categories</option>
    ${theme.categories.map((x) => `<option>${x}</option>`).join("")}</select><button id="bulk-done" class="ghost">Done All</button><div style="display: flex; gap: 0.5rem">
    <button id="reset-seeds" class="ghost">Restore Seeds</button><button id="clear-all" class="danger ghost">Clear All</button></div></div></div><div id="plan"></div><div id="completed-plan" class="completed-section"></div></section></main>
  <section class="panel week-panel"><div class="panel-title"><h2>Seven-day load</h2><label>Daily capacity
    <input id="capacity" type="number" min="15" max="480" step="15" value="90"></label></div><div id="week" class="week"></div></section>
`;

const form = document.querySelector<HTMLFormElement>("#record-form")!;
const errors = document.querySelector<HTMLParagraphElement>("#errors")!;
const capacity = document.querySelector<HTMLInputElement>("#capacity")!;

const handleFormSubmit = () => {
  const data = new FormData(form);
  const now = new Date().toISOString();
  const item: LifeRecord = {
    id: crypto.randomUUID(), title: String(data.get("title") ?? "").trim(),
    category: String(data.get("category") ?? ""), dueDate: String(data.get("dueDate") ?? ""),
    effort: Number(data.get("effort")), impact: Number(data.get("impact")), status: "planned",
    notes: String(data.get("notes") ?? "").trim(), createdAt: now, updatedAt: now,
  };
  const complaints = validateRecord(item, theme);
  if (complaints.length) { errors.textContent = complaints.join(" "); return; }
  errors.textContent = ""; store.upsert(item); form.reset();
  (form.elements.namedItem("dueDate") as HTMLInputElement).value = localDay();
};

form.addEventListener("submit", (event) => {
  event.preventDefault();
  handleFormSubmit();
});

// Quick add: Submit form if user presses Enter in the title field
const titleInput = form.querySelector<HTMLInputElement>('[name="title"]');
if (titleInput) {
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleFormSubmit();
      form.reset();
      (form.elements.namedItem("dueDate") as HTMLInputElement).value = localDay();
    }
  });
}

document.querySelector<HTMLSelectElement>("#filter")!.addEventListener("change", (event) => {
  selectedCategory = (event.target as HTMLSelectElement).value; render(store.all());
});
document.querySelector<HTMLInputElement>("#search")!.addEventListener("input", (event) => {
  searchQuery = (event.target as HTMLInputElement).value.toLowerCase();
  render(store.all());
});
capacity.addEventListener("input", () => render(store.all()));
document.querySelector("#seed-export")!.addEventListener("click", () => download("records.json", exportJson(store.all()), "application/json"));
document.querySelector("#csv")!.addEventListener("click", () => download("records.csv", exportCsv(store.all()), "text/csv"));
document.querySelector("#clear-all")!.addEventListener("click", () => {
  if (confirm("Clear all records from the store?")) store.replace([]);
});
document.querySelector("#reset-seeds")!.addEventListener("click", () => {
  if (confirm("Restore default seed tasks? This will replace your current list.")) store.replace(getSeeds());
});
document.querySelector("#bulk-done")!.addEventListener("click", () => {
  const records = store.all();
  const toComplete = buildPlan(records).filter((entry) => {
    const matchesCategory = selectedCategory === "all" || entry.item.category === selectedCategory;
    const matchesSearch = !searchQuery || 
      entry.item.title.toLowerCase().includes(searchQuery) || 
      entry.item.notes.toLowerCase().includes(searchQuery);
    return matchesCategory && matchesSearch && entry.item.status !== "done";
  });
  if (!toComplete.length) return;
  if (confirm(`Mark ${toComplete.length} filtered task(s) as done?`)) {
    const now = new Date().toISOString();
    const updated = records.map(r => {
      const shouldComplete = toComplete.some(e => e.item.id === r.id);
      return shouldComplete ? { ...r, status: "done", updatedAt: now } : r;
    });
    store.replace(updated);
  }
});
document.querySelector<HTMLInputElement>("#import")!.addEventListener("change", async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
  try { store.replace(importJson(await file.text(), theme)); errors.textContent = ""; }
  catch (error) { errors.textContent = error instanceof Error ? error.message : "Import failed."; }
});

function render(records: readonly LifeRecord[]): void {
  const summary = summarize(records);
  const categoryBadges = Object.entries(summary.byCategory)
    .filter(([_, count]) => count > 0)
    .map(([cat, count]) => `<span class="badge" style="margin-right: 0.5rem">${escapeH(cat)}: ${count}</span>`)
    .join("");

  document.querySelector("#summary")!.innerHTML = [
    ["Open", summary.total - summary.completed], ["Due soon", summary.dueSoon],
    ["Overdue", summary.overdue, summary.overdue > 0 ? "style='color: #a33232'" : ""], [theme.effortLabel, summary.effort],
  ].map(([label, value, style = ""]) => `<article><span>${label}</span><strong ${style}>${value}</strong></article>`).join("") + 
  `<article style="grid-column: span 4; padding: 0.5rem 1.2rem; border-top: 1px solid #dce7e1; margin-top: 0.5rem; font-size: 0.8rem; color: #668078">${categoryBadges || 'No items categorized'}</article>`;

  const plan = buildPlan(records).filter((entry) => {
    const matchesCategory = selectedCategory === "all" || entry.item.category === selectedCategory;
    const matchesSearch = !searchQuery || 
      entry.item.title.toLowerCase().includes(searchQuery) || 
      entry.item.notes.toLowerCase().includes(searchQuery);
    return matchesCategory && matchesSearch;
  });

  document.querySelector("#plan")!.innerHTML = plan.length ? plan.map((entry) => `<article class="record ${entry.item.status === 'active' ? 'is-active' : ''} ${entry.daysUntilDue < 0 ? 'is-overdue' : ''} ${entry.item.impact >= 5 ? 'is-high-impact' : ''}">
    <div style="display: flex; gap: 1rem; align-items: flex-start">
      <input type="checkbox" data-done="${escapeH(entry.item.id)}" ${entry.item.status === 'done' ? 'checked' : ''} style="width: 1.2rem; height: 1.2rem; margin-top: 0.4rem">
      <div>
        <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.25rem">
          <select data-category="${escapeH(entry.item.id)}" style="width: auto; padding: 0.1rem 0.4rem; font-size: 0.7rem; border-radius: 99px; border: 1px solid #cbdad3; background: #e4f0eb; color: #176b55; font-weight: 800;">
            ${theme.categories.map(cat => `<option ${cat === entry.item.category ? 'selected' : ''}>${cat}</option>`).join("")}
          </select>
          ${entry.item.status === 'active' ? '<span class="badge active-badge">Active</span>' : ''}
          ${entry.item.impact >= 5 ? '<span class="badge priority-badge">Priority</span>' : ''}
        </div>
        <h3 contenteditable="true" data-id="${escapeH(entry.item.id)}" data-field="title" style="${entry.item.status === 'done' ? 'text-decoration: line-through; opacity: 0.6' : ''}">${escapeH(entry.item.title)}</h3>
        <p contenteditable="true" data-id="${escapeH(entry.item.id)}" data-field="notes" class="editable-notes" style="${entry.item.status === 'done' ? 'opacity: 0.4' : ''}">${escapeH(entry.item.notes || "Add notes...")}</p>
        <p class="reasons">${escapeH(entry.reasons.join("; "))}</p>
      </div>
    </div>
    <div class="record-actions"><div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.2rem">
      <strong style="${entry.item.status === 'done' ? 'opacity: 0.4' : ''}">${entry.score}</strong>
      <div style="display: flex; gap: 0.25rem; font-size: 0.7rem; opacity: 0.8">
        <input type="date" data-id="${escapeH(entry.item.id)}" data-field="dueDate" value="${entry.item.dueDate}" style="width: 130px; padding: 0.1rem 0.2rem; font-size: 0.7rem" ${entry.item.status === 'done' ? 'disabled' : ''}>
        <input type="number" data-id="${escapeH(entry.item.id)}" data-field="effort" value="${entry.item.effort}" style="width: 45px; padding: 0.1rem 0.2rem; font-size: 0.7rem" ${entry.item.status === 'done' ? 'disabled' : ''}>
        <input type="number" data-id="${escapeH(entry.item.id)}" data-field="impact" value="${entry.item.impact}" style="width: 40px; padding: 0.1rem 0.2rem; font-size: 0.7rem" ${entry.item.status === 'done' ? 'disabled' : ''}>
      </div>
      <div style="display: flex; gap: 0.25rem">
        <button class="ghost" style="font-size: 0.6rem; padding: 0.1rem 0.4rem; margin-top: 0.2rem" data-set-priority="${escapeH(entry.item.id)}" ${entry.item.status === 'done' ? 'disabled' : ''}>★ High</button>
        <button class="ghost" style="font-size: 0.6rem; padding: 0.1rem 0.4rem; margin-top: 0.2rem" data-move-top="${escapeH(entry.item.id)}" ${entry.item.status === 'done' ? 'disabled' : ''}>↑ Top</button>
      </div>
    </div><select data-status="${escapeH(entry.item.id)}">
    ${(["planned", "active", "done"] as ItemStatus[]).map((status) => `<option ${status === entry.item.status ? "selected" : ""}>${status}</option>`).join("")}</select>
    <div style="display: flex; flex-direction: column; gap: 0.25rem">
      <button class="ghost" style="font-size: 0.6rem; padding: 0.1rem 0.4rem" data-toggle-active="${escapeH(entry.item.id)}" ${entry.item.status === 'done' ? 'disabled' : ''}>${entry.item.status === 'active' ? 'Stop' : 'Start'}</button>
      <button class="ghost" style="font-size: 0.6rem; padding: 0.1rem 0.4rem" data-move-today="${escapeH(entry.item.id)}" ${entry.item.status === 'done' ? 'disabled' : ''}>Today</button>
      <button class="ghost" style="font-size: 0.6rem; padding: 0.1rem 0.4rem" data-dup="${escapeH(entry.item.id)}">Dup</button>
      <button class="danger ghost" data-remove="${escapeH(entry.item.id)}">Remove</button>
    </div></article>`).join("") : "<p class='empty'>No open records match this view.</p>";

  const completed = records.filter(r => {
    const matchesCategory = selectedCategory === "all" || r.category === selectedCategory;
    const matchesSearch = !searchQuery || 
      r.title.toLowerCase().includes(searchQuery) || 
      r.notes.toLowerCase().includes(searchQuery);
    return r.status === "done" && matchesCategory && matchesSearch;
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  document.querySelector("#completed-plan")!.innerHTML = completed.length ? `
    <details style="margin-top: 2rem; border-top: 1px solid #dce7e1; padding-top: 1rem">
      <summary style="cursor: pointer; color: #668078; font-weight: 700; font-size: 0.9rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center">
        <span>Completed Tasks (${completed.length})</span>
        <button id="clear-completed" class="ghost" style="font-size: 0.7rem; padding: 0.2rem 0.5rem">Archive All</button>
      </summary>
      ${completed.map(item => `<article class="record" style="opacity: 0.7">
        <div style="display: flex; gap: 1rem; align-items: flex-start">
          <input type="checkbox" data-done="${escapeH(item.id)}" checked style="width: 1.2rem; height: 1.2rem; margin-top: 0.4rem">
          <div>
            <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.25rem">
              <span class="badge">${escapeH(item.category)}</span>
            </div>
            <h3 style="text-decoration: line-through; opacity: 0.6">${escapeH(item.title)}</h3>
            <p class="editable-notes" style="opacity: 0.4">${escapeH(item.notes || "")}</p>
          </div>
        </div>
        <div class="record-actions">
          <div style="display: flex; gap: 0.25rem">
            <button class="ghost" style="font-size: 0.6rem; padding: 0.1rem 0.4rem" data-dup="${escapeH(item.id)}">Dup</button>
            <button class="danger ghost" data-remove="${escapeH(item.id)}" style="font-size: 0.7rem; padding: 0.4rem 0.6rem">Remove</button>
          </div>
        </div>
      </article>`).join("")}
    </details>
  ` : "";

  if (document.querySelector("#clear-completed")) {
    document.querySelector("#clear-completed")!.onclick = () => {
      if (confirm("Permanently remove all completed tasks?")) {
        store.replace(records.filter(r => r.status !== "done"));
      }
    };
  }

  for (const checkbox of document.querySelectorAll<HTMLInputElement>("[data-done]")) {
    checkbox.onchange = () => {
      const id = checkbox.dataset.done!;
      const item = records.find((x) => x.id === id);
      if (!item) return;
      store.upsert({ ...item, status: checkbox.checked ? "done" : "planned", updatedAt: new Date().toISOString() });
    };
  }

  for (const select of document.querySelectorAll<HTMLSelectElement>("[data-status]")) select.onchange = () => {
    const item = records.find((x) => x.id === select.dataset.status);
    if (!item) return;
    store.upsert({ ...item, status: select.value as ItemStatus, updatedAt: new Date().toISOString() });
  };

  for (const catSelect of document.querySelectorAll<HTMLSelectElement>("[data-category]")) catSelect.onchange = () => {
    const item = records.find((x) => x.id === catSelect.dataset.category);
    if (!item) return;
    store.upsert({ ...item, category: catSelect.value, updatedAt: new Date().toISOString() });
  };

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-remove]")) button.onclick = () => {
    const id = button.dataset.remove!;
    const item = records.find(x => x.id === id);
    if (item && confirm(`Remove "${item.title}"?`)) store.remove(id);
  };
  
  for (const priorityBtn of document.querySelectorAll<HTMLButtonElement>("[data-set-priority]")) {
    priorityBtn.onclick = () => {
      const id = priorityBtn.dataset.setPriority!;
      const item = records.find(x => x.id === id);
      if (item) store.upsert({ ...item, impact: 5, updatedAt: new Date().toISOString() });
    };
  }

  for (const moveBtn of document.querySelectorAll<HTMLButtonElement>("[data-move-top]")) {
    moveBtn.onclick = () => {
      const id = moveBtn.dataset.moveTop!;
      const item = records.find(x => x.id === id);
      if (item) {
        store.upsert({ ...item, impact: 5, effort: 1, updatedAt: new Date().toISOString() });
      }
    };
  }

  for (const moveTodayBtn of document.querySelectorAll<HTMLButtonElement>("[data-move-today]")) {
    moveTodayBtn.onclick = () => {
      const id = moveTodayBtn.dataset.moveToday!;
      const item = records.find(x => x.id === id);
      if (item) {
        store.upsert({ ...item, dueDate: localDay(), updatedAt: new Date().toISOString() });
      }
    };
  }

  for (const activeBtn of document.querySelectorAll<HTMLButtonElement>("[data-toggle-active]")) {
    activeBtn.onclick = () => {
      const id = activeBtn.dataset.toggleActive!;
      const item = records.find(x => x.id === id);
      if (item) {
        store.upsert({ ...item, status: item.status === 'active' ? 'planned' : 'active', updatedAt: new Date().toISOString() });
      }
    };
  }

  for (const dupBtn of document.querySelectorAll<HTMLButtonElement>("[data-dup]")) {
    dupBtn.onclick = () => {
      const id = dupBtn.dataset.dup!;
      const item = records.find(x => x.id === id);
      if (!item) return;
      const now = new Date().toISOString();
      store.upsert({
        ...item,
        id: crypto.randomUUID(),
        title: `${item.title} (Copy)`,
        status: "planned",
        createdAt: now,
        updatedAt: now
      });
    };
  }

  for (const editable of document.querySelectorAll<HTMLElement>("[contenteditable='true']")) {
    editable.onblur = () => {
      const id = editable.dataset.id!; const field = editable.dataset.field!; const value = editable.textContent?.trim() ?? "";
      const item = records.find(x => x.id === id); if (!item) return;
      if (item[field as keyof LifeRecord] !== value) {
        store.upsert({ ...item, [field]: value, updatedAt: new Date().toISOString() });
      }
    };
  }

  for (const input of document.querySelectorAll<HTMLInputElement>("[data-field]")) {
    input.onblur = () => {
      const id = input.dataset.id!; const field = input.dataset.field!; 
      const value = field === "dueDate" ? input.value : Number(input.value);
      const item = records.find(x => x.id === id); if (!item) return;
      if (item[field as keyof LifeRecord] !== value) {
        store.upsert({ ...item, [field]: value, updatedAt: new Date().toISOString() });
      }
    };
  }

  const filteredRecords = records.filter(r => {
    const matchesCategory = selectedCategory === "all" || r.category === selectedCategory;
    const matchesSearch = !searchQuery || 
      r.title.toLowerCase().includes(searchQuery) || 
      r.notes.toLowerCase().includes(searchQuery);
    return r.status !== "done" && matchesCategory && matchesSearch;
  });

  document.querySelector("#week")!.innerHTML = suggestDailyLoad(filteredRecords, Number(capacity.value) || 90).map((day) => `<article class="day ${day.overloaded ? "over" : ""}">
    <span>${new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" })}</span><strong>${day.used} min</strong>
    <div class="day-tasks">${day.entries.map(e => `<div class="day-task" style="${e.daysUntilDue < 0 ? 'color: #a33232; font-weight: 700' : ''}">${escapeH(e.item.title)}</div>`).join("")}</div>
    <small>${day.entries.length} item(s)</small></article>`).join("");
}

function escapeH(v: unknown) { return escapeHtml(v); }

store.subscribe(render);
