// The chapters, in reading order. Each is a markdown file in documentation/ —
// that folder is the documentation; this page only renders it. README.md and
// the per-folder READMEs stay short and point here.
//
// The ids are the filenames *and* the URL hash, so renaming a chapter file
// changes its deep links.
const CHAPTERS = [
  { id: "overview", title: "Overview" },
  { id: "frontend", title: "Frontend" },
  { id: "api", title: "API" },
  { id: "scraping", title: "Scraping" },
  { id: "headlines", title: "Headlines" },
  { id: "search", title: "Search" },
  { id: "archive-views", title: "Archive views" },
  { id: "match-dates", title: "Match dates" },
  { id: "deployment", title: "Deployment" },
  { id: "multimodal", title: "Multimodal", group: "AI" },
  { id: "classic-classifiers", title: "Classic Classifiers", group: "AI" },
  { id: "image-embeddings", title: "Image Embeddings", group: "AI" },
  { id: "headline-embeddings", title: "Headline Embeddings", group: "AI" },
  { id: "rag", title: "RAG", group: "AI" },
  { id: "ai-detector", title: "AI Detector", group: "AI" },
];

// ---- Markdown rendering ----
//
// Hand-written rather than a library — this project has no build step and no
// dependencies anywhere in its frontend, and a docs page is not the place to
// start. Covers the subset these chapters actually use: headings, paragraphs,
// nested dash lists, numbered lists, fenced code, tables, blockquotes, hr,
// and inline bold/italic/code/links. Anything else degrades to a plain
// paragraph, never to broken HTML — every piece of text passes through esc()
// before any inline markup is applied.

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return "\x00" + (codes.length - 1) + "\x00";
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) =>
    /^(https?:\/\/|\/|#)/.test(href) ? `<a href="${href}">${text}</a>` : text,
  );
  return s.replace(/\x00(\d+)\x00/g, (_, i) => `<code>${codes[i]}</code>`);
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function renderMarkdown(md) {
  const lines = md.split("\n");
  const out = [];
  const sections = []; // {slug, text} for every ## — feeds the sidebar
  let i = 0;

  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const listItem = (l) => l.match(/^(\s*)-\s+(.*)$/);

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const slug = slugify(text);
      if (level === 2) sections.push({ slug, text });
      out.push(`<h${level} id="${level > 1 ? slug : ""}">${inline(esc(text))}</h${level}>`);
      i++;
      continue;
    }

    if (/^---+\s*$/.test(line)) { out.push("<hr />"); i++; continue; }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote><p>${inline(esc(buf.join(" ")))}</p></blockquote>`);
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => inline(esc(c.trim())));
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") +
          "</tbody></table>",
      );
      continue;
    }

    if (listItem(line)) {
      const items = [];
      while (i < lines.length) {
        const m = listItem(lines[i]);
        if (m) {
          items.push({ depth: m[1].length >= 2 ? 1 : 0, text: m[2] });
          i++;
        } else if (/^\s{2,}\S/.test(lines[i]) && items.length > 0) {
          items[items.length - 1].text += " " + lines[i].trim();
          i++;
        } else break;
      }
      let html = "<ul>";
      let depth = 0;
      for (const it of items) {
        if (it.depth > depth) { html += "<ul>"; depth = it.depth; }
        else if (it.depth < depth) { html += "</li></ul></li>"; depth = it.depth; }
        else if (html !== "<ul>") html += "</li>";
        html += `<li>${inline(esc(it.text))}`;
      }
      html += "</li>" + (depth > 0 ? "</ul></li>" : "") + "</ul>";
      out.push(html);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*\d+\.\s+(.*)$/);
        if (m) { items.push(m[1]); i++; }
        else if (/^\s{2,}\S/.test(lines[i]) && items.length > 0) { items[items.length - 1] += " " + lines[i].trim(); i++; }
        else break;
      }
      out.push(`<ol>${items.map((t) => `<li>${inline(esc(t))}</li>`).join("")}</ol>`);
      continue;
    }

    const buf = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,3})\s/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !listItem(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !isTableRow(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${inline(esc(buf.join(" ")))}</p>`);
  }

  return { html: out.join("\n"), sections };
}

// ---- Navigation ----
//
// Hash routing: #<chapter> opens a chapter, #<chapter>/<section-slug> also
// scrolls to that ## heading. The hash is the whole state, so a deep link
// pasted into another browser lands on the same spot.

const nav = document.getElementById("nav");
const content = document.getElementById("content");
const cache = new Map();
let current = null;

function parseHash() {
  const [chapter, section] = location.hash.replace(/^#/, "").split("/");
  return { chapter: CHAPTERS.some((c) => c.id === chapter) ? chapter : CHAPTERS[0].id, section: section || null };
}

function renderNav(activeId, sections) {
  let openGroup = null;
  nav.innerHTML = CHAPTERS.map((c) => {
    // A group label above the first chapter of each run of chapters sharing
    // a `group` — chapters must sit adjacent in CHAPTERS for this to render
    // as one group instead of repeating the label.
    let groupLabel = "";
    if (c.group !== openGroup) {
      openGroup = c.group;
      if (c.group) groupLabel = `<div class="nav-group">${c.group}</div>`;
    }
    const link = `<a href="#${c.id}" class="${c.id === activeId ? "active" : ""}">${c.title}</a>`;
    if (c.id !== activeId || sections.length === 0) return groupLabel + link;
    return groupLabel + link + sections.map((s) => `<a class="section" href="#${c.id}/${s.slug}">${s.text.replace(/`/g, "")}</a>`).join("");
  }).join("");
}

async function show() {
  const { chapter, section } = parseHash();
  if (chapter !== current) {
    current = chapter;
    if (!cache.has(chapter)) {
      try {
        const res = await fetch(`documentation/${chapter}.md`);
        if (!res.ok) throw new Error(String(res.status));
        cache.set(chapter, renderMarkdown(await res.text()));
      } catch {
        cache.set(chapter, { html: '<p class="error">Não foi possível carregar este capítulo.</p>', sections: [] });
      }
    }
    const doc = cache.get(chapter);
    content.innerHTML = doc.html;
    renderNav(chapter, doc.sections);
  }
  if (section) {
    const el = document.getElementById(section);
    if (el) el.scrollIntoView();
  } else {
    window.scrollTo(0, 0);
  }
}

window.addEventListener("hashchange", show);
show();
