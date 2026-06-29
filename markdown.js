(function () {
  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  }

  function inlineFormat(s) {
    return String(s || "")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  }

  function render(text) {
    if (!text || !String(text).trim()) return "";

    const lines = String(text).split("\n");
    const html = [];
    let inUl = false;
    let inOl = false;

    function closeLists() {
      if (inUl) {
        html.push("</ul>");
        inUl = false;
      }
      if (inOl) {
        html.push("</ol>");
        inOl = false;
      }
    }

    for (const raw of lines) {
      const trimmed = raw.trim();

      if (!trimmed) {
        closeLists();
        continue;
      }

      const h3 = trimmed.match(/^###\s+(.+)/);
      const h2 = trimmed.match(/^##\s+(.+)/);
      const h1 = trimmed.match(/^#\s+(.+)/);
      const bullet = trimmed.match(/^[-*•–—]\s+(.+)/);
      const numbered = trimmed.match(/^\d+[.)]\s+(.+)/);

      if (h3) {
        closeLists();
        html.push(`<h4 class="md-h3">${inlineFormat(escapeHtml(h3[1]))}</h4>`);
        continue;
      }
      if (h2) {
        closeLists();
        html.push(`<h3 class="md-h2">${inlineFormat(escapeHtml(h2[1]))}</h3>`);
        continue;
      }
      if (h1) {
        closeLists();
        html.push(`<h3 class="md-h1">${inlineFormat(escapeHtml(h1[1]))}</h3>`);
        continue;
      }
      if (bullet) {
        if (!inUl) {
          closeLists();
          html.push('<ul class="md-list">');
          inUl = true;
        }
        html.push(`<li>${inlineFormat(escapeHtml(bullet[1]))}</li>`);
        continue;
      }
      if (numbered) {
        if (!inOl) {
          closeLists();
          html.push('<ol class="md-list">');
          inOl = true;
        }
        html.push(`<li>${inlineFormat(escapeHtml(numbered[1]))}</li>`);
        continue;
      }

      closeLists();
      html.push(`<p>${inlineFormat(escapeHtml(trimmed))}</p>`);
    }

    closeLists();
    return html.join("");
  }

  window.Markdown = { render, escapeHtml };
})();
