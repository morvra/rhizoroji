import fs from 'fs';

function renderMarkdownToHTML(content, allNotes) {
  // コードブロックを一時退避
  const codeBlocks = [];
  let html = content.replace(/```([\s\S]*?)```/g, (match, code) => {
    const index = codeBlocks.length;
    codeBlocks.push(code);
    return `__CODE_BLOCK_${index}__`;
  });

  // インラインコードを一時退避
  const inlineCodes = [];
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    const index = inlineCodes.length;
    inlineCodes.push(code);
    return `__INLINE_CODE_${index}__`;
  });

  // エスケープ
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 見出し
  html = html
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>');

  // 装飾
  html = html
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/~~(.*?)~~/g, '<del>$1</del>');

  // 水平線
  html = html.replace(/^(---|\*\*\*)$/gm, '<hr>');

  // 行ごとに処理
  const lines = html.split('\n');
  const processedLines = [];
  
  let inTable = false;
  let tableBuffer = [];
  let inBlockquote = false;
  let blockquoteBuffer = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 表の処理
    if (line.includes('|')) {
      if (inBlockquote) {
        processedLines.push(`<blockquote>${blockquoteBuffer.join('<br>')}</blockquote>`);
        inBlockquote = false;
        blockquoteBuffer = [];
      }
      
      if (!inTable) {
        inTable = true;
        tableBuffer = [];
      }
      tableBuffer.push(line);
      continue;
    } else if (inTable) {
      processedLines.push(renderTable(tableBuffer));
      inTable = false;
      tableBuffer = [];
    }

    // 引用の処理
    if (line.startsWith('&gt; ')) {
      if (!inBlockquote) {
        inBlockquote = true;
        blockquoteBuffer = [];
      }
      blockquoteBuffer.push(line.substring(5));
      continue;
    } else if (inBlockquote) {
      processedLines.push(`<blockquote>${blockquoteBuffer.join('<br>')}</blockquote>`);
      inBlockquote = false;
      blockquoteBuffer = [];
    }

    // その他の行
    processedLines.push(line);
  }

  // 残りの引用があれば処理
  if (inBlockquote) {
    processedLines.push(`<blockquote>${blockquoteBuffer.join('<br>')}</blockquote>`);
  }

  // 残りの表があれば処理
  if (inTable) {
    processedLines.push(renderTable(tableBuffer));
  }

  html = processedLines.join('\n');

  // リストを構造化（入れ子対応）
  html = processNestedLists(html);

  // Markdown リンクと画像（URLリンク化の前に処理）
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // 素の URL をリンク化（画像処理の後）
  html = html.replace(/(?<!href="|src="|<img src=")(?<!<a href=")(https?:\/\/[^\s<]+)(?!">)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

  // Wikiリンク
  html = html.replace(/\[\[(.*?)\]\]/g, (match, title) => {
    const target = allNotes.find(n => n.title === title);
    return target 
      ? `<a href="${target.id}.html" class="wiki-link">${title}</a>`
      : title;
  });

  // コードブロックを復元
  codeBlocks.forEach((code, index) => {
    html = html.replace(`__CODE_BLOCK_${index}__`, 
      `<pre><code>${code}</code></pre>`);
  });

  // インラインコードを復元
  inlineCodes.forEach((code, index) => {
    html = html.replace(`__INLINE_CODE_${index}__`, 
      `<code>${code}</code>`);
  });

  // 改行
  html = html.replace(/\n/g, '<br>');

  return html;
}

function renderTable(lines) {
  if (lines.length < 2) return lines.join('\n');

  const rows = lines.map(line => 
    line.split('|')
      .map(cell => cell.trim())
      .filter((cell, i, arr) => i > 0 && i < arr.length - 1)
  );

  const isSeparator = rows[1] && rows[1].every(cell => /^:?-+:?$/.test(cell));

  let html = '<table>';

  if (isSeparator) {
    html += '<thead><tr>';
    rows[0].forEach(cell => {
      html += `<th>${cell}</th>`;
    });
    html += '</tr></thead><tbody>';

    for (let i = 2; i < rows.length; i++) {
      html += '<tr>';
      rows[i].forEach(cell => {
        html += `<td>${cell}</td>`;
      });
      html += '</tr>';
    }
  } else {
    html += '<tbody>';
    rows.forEach(row => {
      html += '<tr>';
      row.forEach(cell => {
        html += `<td>${cell}</td>`;
      });
      html += '</tr>';
    });
  }

  html += '</tbody></table>';
  return html;
}

function processNestedLists(html) {
  const lines = html.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    
    const taskMatch = line.match(/^(\s*)- \[([ x])\] (.*)$/);
    if (taskMatch) {
      const listBlock = extractListBlock(lines, i, 'task');
      result.push(buildNestedList(listBlock, 'task'));
      i += listBlock.length;
      continue;
    }

    const ulMatch = line.match(/^(\s*)- (.*)$/);
    if (ulMatch) {
      const listBlock = extractListBlock(lines, i, 'ul');
      result.push(buildNestedList(listBlock, 'ul'));
      i += listBlock.length;
      continue;
    }

    const olMatch = line.match(/^(\s*)\d+\. (.*)$/);
    if (olMatch) {
      const listBlock = extractListBlock(lines, i, 'ol');
      result.push(buildNestedList(listBlock, 'ol'));
      i += listBlock.length;
      continue;
    }

    result.push(line);
    i++;
  }

  return result.join('\n');
}

function extractListBlock(lines, startIndex, type) {
  const block = [];
  let regex;
  
  if (type === 'task') {
    regex = /^(\s*)- \[([ x])\] (.*)$/;
  } else if (type === 'ul') {
    regex = /^(\s*)- (.*)$/;
  } else {
    regex = /^(\s*)\d+\. (.*)$/;
  }

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (regex.test(line)) {
      block.push(line);
    } else if (line.trim() === '') {
      break;
    } else {
      break;
    }
  }

  return block;
}

function buildNestedList(lines, type) {
  if (lines.length === 0) return '';

  const items = lines.map(line => {
    let match;
    if (type === 'task') {
      match = line.match(/^(\s*)- \[([ x])\] (.*)$/);
      return {
        indent: match[1].length,
        checked: match[2] === 'x',
        text: match[3]
      };
    } else if (type === 'ul') {
      match = line.match(/^(\s*)- (.*)$/);
      return {
        indent: match[1].length,
        text: match[2]
      };
    } else {
      match = line.match(/^(\s*)\d+\. (.*)$/);
      return {
        indent: match[1].length,
        text: match[2]
      };
    }
  });

  const listTag = type === 'task' ? 'ul' : type;
  const listClass = type === 'task' ? ' class="task-list"' : '';

  function buildTree(items, currentIndent = 0) {
    let html = `<${listTag}${currentIndent === 0 ? listClass : ''}>`;
    let i = 0;

    while (i < items.length) {
      const item = items[i];

      if (item.indent < currentIndent) {
        break;
      }

      if (item.indent === currentIndent) {
        if (type === 'task') {
          html += `<li class="${item.checked ? 'done' : ''}">`;
          html += `<svg class="task-icon" width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>${item.checked ? '<path d="M4.5 8L7 10.5L11.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' : ''}</svg>`;
          html += item.text;
        } else {
          html += `<li>${item.text}`;
        }

        if (i + 1 < items.length && items[i + 1].indent > currentIndent) {
          const nestedItems = [];
          let j = i + 1;
          while (j < items.length && items[j].indent > currentIndent) {
            nestedItems.push(items[j]);
            j++;
          }
          html += buildTree(nestedItems, currentIndent + 2);
          i = j;
        } else {
          i++;
        }

        html += '</li>';
      } else {
        i++;
      }
    }

    html += `</${listTag}>`;
    return html;
  }

  return buildTree(items);
}

function findRelatedNotes(note, allNotes) {
  const result = {
    outgoing: [],      // このノートから他へのリンク
    backlinks: [],     // 他のノートからこのノートへのリンク
    twoHop: new Map()  // 2-hop links (hub noteをキーにした Map)
  };
  
  // 1. Outgoing links（本文内のWikiリンク）
  const wikiLinkRegex = /\[\[(.*?)\]\]/g;
  let match;
  const linkedTitles = new Set();
  
  while ((match = wikiLinkRegex.exec(note.content)) !== null) {
    linkedTitles.add(match[1]);
  }
  
  linkedTitles.forEach(title => {
    const target = allNotes.find(n => n.title === title);
    if (target && target.id !== note.id) {
      result.outgoing.push(target);
    }
    // Ghost noteは追加しない（表示させないため）
  });
  
  // 2. Backlinks（このノートへのリンク）
  const titleRegex = new RegExp(`\\[\\[${note.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`);
  
  allNotes.forEach(other => {
    if (other.id === note.id) return;
    if (titleRegex.test(other.content)) {
      result.backlinks.push(other);
    }
  });
  
  // 3. Direct references（Outgoing + Backlinks の統合リスト、重複なし）
  const directIds = new Set([
    ...result.outgoing.filter(n => !n.isGhost).map(n => n.id),
    ...result.backlinks.map(n => n.id)
  ]);
  
  // 4. 2-hop links（Related via...）
  const directNotes = [
    ...result.outgoing.filter(n => !n.isGhost),
    ...result.backlinks
  ];
  
  directNotes.forEach(directNote => {
    const relatedViaThis = [];
    
    if (directNote.isGhost) return;
    
    // directNote の Outgoing
    const directNoteLinks = new Set();
    let m;
    while ((m = wikiLinkRegex.exec(directNote.content)) !== null) {
      directNoteLinks.add(m[1]);
    }
    
    directNoteLinks.forEach(linkedTitle => {
      if (linkedTitle === note.title) return;
      if (linkedTitle === directNote.title) return;
      
      const target = allNotes.find(n => n.title === linkedTitle);
      if (target && target.id !== note.id && !directIds.has(target.id)) {
        relatedViaThis.push(target);
      }
      // Ghost noteは追加しない
    });
    
    // directNote への Backlinks
    const directNoteTitleRegex = new RegExp(`\\[\\[${directNote.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`);
    
    allNotes.forEach(other => {
      if (other.id === note.id) return;
      if (other.id === directNote.id) return;
      if (directIds.has(other.id)) return;
      
      if (directNoteTitleRegex.test(other.content)) {
        relatedViaThis.push(other);
      }
    });
    
    // 重複削除
    const uniqueRelated = relatedViaThis.filter((n, i, self) => 
      i === self.findIndex(s => s.title === n.title)
    );
    
    if (uniqueRelated.length > 0) {
      result.twoHop.set(directNote, uniqueRelated);
    }
  });
  
  return result;
}

function buildSite() {
  console.log('🏗️  Building static site...');
  
  if (!fs.existsSync('data/notes.json')) {
    console.log('⚠️  No notes.json found. Skipping build.');
    return;
  }
  
  const notes = JSON.parse(fs.readFileSync('data/notes.json', 'utf-8'));
  
  if (notes.length === 0) {
    console.log('⚠️  No published notes found. Skipping build.');
    return;
  }
  
  if (!fs.existsSync('public')) {
    fs.mkdirSync('public');
  }
  
  // フォルダ構造を構築
  function buildFolderStructure(notes) {
    const folders = new Map();
    const rootNotes = [];
    
    notes.forEach(note => {
      const folderName = note.folderName;
      
      if (folderName) {
        // フォルダあり
        if (!folders.has(folderName)) {
          folders.set(folderName, []);
        }
        folders.get(folderName).push(note);
      } else {
        // フォルダなし（Root）
        rootNotes.push(note);
      }
    });
    
    // フォルダをアルファベット順にソート
    const sortedFolders = Array.from(folders.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, notes]) => ({ name, notes }));
    
    return { folders: sortedFolders, rootNotes };
  }
  
  // 共通のヘッダー・サイドバーHTML生成
function generateCommonHTML(currentNoteId = null) {
  const { folders: folderList, rootNotes } = buildFolderStructure(notes);
  
  return {
    header: `
      <header>
        <div class="header-content">
          <button class="menu-button" onclick="toggleSidebar()">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12h18M3 6h18M3 18h18"/>
            </svg>
          </button>
          <a href="index.html" class="site-title">🍵Rhizoroji</a>
          <div style="display: flex; gap: 0.5rem;">
            <button class="search-button" onclick="toggleSearch()" title="Search (Ctrl+K)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/>
                <path d="M21 21l-4.35-4.35"/>
              </svg>
            </button>
            <button class="random-button" onclick="openRandomNote()" title="Random Note">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>
              </svg>
            </button>
          </div>
        </div>
      </header>
      <div class="overlay" onclick="toggleSidebar()"></div>
      <div class="search-modal" id="searchModal" onclick="closeSearchOnOverlay(event)">
        <div class="search-modal-content">
          <div class="search-input-wrapper">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="M21 21l-4.35-4.35"/>
            </svg>
            <input type="text" id="searchInput" placeholder="Search notes..." autocomplete="off">
            <button class="search-close" onclick="toggleSearch()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <div class="search-results" id="searchResults"></div>
        </div>
      </div>
`,
    sidebar: `
      <aside class="sidebar" id="sidebar">
        ${folderList.map(folder => `
          <div class="folder-section">
            <div class="folder-header" onclick="toggleFolder(this)">
              <svg class="folder-icon" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6 4L12 8L6 12V4Z"/>
              </svg>
              <span>${folder.name}</span>
            </div>
            <ul class="folder-notes">
              ${folder.notes.map(n => `<li><a href="${n.id}.html" ${n.id === currentNoteId ? 'class="active"' : ''}>${n.title}</a></li>`).join('')}
            </ul>
          </div>
        `).join('')}
        
        ${rootNotes.length > 0 ? `
          <div class="folder-section">
            <ul class="folder-notes" style="max-height: none;">
              ${rootNotes.map(n => `<li><a href="${n.id}.html" ${n.id === currentNoteId ? 'class="active"' : ''}>${n.title}</a></li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </aside>
    `,
    styles: `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        font-family: system-ui, -apple-system, sans-serif;
        background: #f9fafb;
        color: #374151;
        scrollbar-gutter: stable;
      }
      
      /* スクロールバーのスタイル統一 */
      ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      ::-webkit-scrollbar-track {
        background: transparent;
      }
      ::-webkit-scrollbar-thumb {
        background: #d1d5db;
        border-radius: 4px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: #9ca3af;
      }
      * {
        scrollbar-width: thin;
        scrollbar-color: #d1d5db transparent;
      }
      
      /* ヘッダー */
      header {
        background: white;
        border-bottom: 1px solid #e5e7eb;
        padding: .5rem 1rem;
        position: sticky;
        top: 0;
        z-index: 100;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      }
      .header-content {
        max-width: 1400px;
        margin: 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .site-title {
        font-size: 1.5rem;
        font-weight: 700;
        color: #1f2937;
        text-decoration: none;
      }
      .site-title:hover {
        text-decoration: none;
      }
      .menu-button {
        background: none;
        border: none;
        cursor: pointer;
        padding: 0.5rem;
        color: #6b7280;
        transition: color 0.2s;
      }
      .menu-button:hover {
        color: #1f2937;
      }
      .random-button {
        background: none;
        border: none;
        cursor: pointer;
        padding: 0.5rem;
        color: #6b7280;
        transition: color 0.2s;
        display: flex;
        align-items: center;
      }
      .random-button:hover {
        color: #4f46e5;
      }
      .search-button {
        background: none;
        border: none;
        cursor: pointer;
        padding: 0.5rem;
        color: #6b7280;
        transition: color 0.2s;
        display: flex;
        align-items: center;
      }
      .search-button:hover {
        color: #4f46e5;
      }
      
      /* 検索モーダル */
      .search-modal {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: 200;
        padding: 2rem;
        align-items: flex-start;
        justify-content: center;
        padding-top: 10vh;
      }
      .search-modal.show {
        display: flex;
      }
      .search-modal-content {
        background: white;
        border-radius: 0.75rem;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        width: 100%;
        max-width: 600px;
        max-height: 70vh;
        display: flex;
        flex-direction: column;
      }
      .search-input-wrapper {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem 1.25rem;
        border-bottom: 1px solid #e5e7eb;
      }
      .search-input-wrapper svg:first-child {
        color: #9ca3af;
        flex-shrink: 0;
      }
      .search-input-wrapper input {
        flex: 1;
        border: none;
        outline: none;
        font-size: 1rem;
        color: #1f2937;
      }
      .search-close {
        background: none;
        border: none;
        cursor: pointer;
        padding: 0.25rem;
        color: #9ca3af;
        display: flex;
        align-items: center;
        transition: color 0.2s;
      }
      .search-close:hover {
        color: #1f2937;
      }
      .search-results {
        overflow-y: auto;
        max-height: calc(70vh - 4rem);
      }
      .search-result-item {
        padding: 0.875rem 1.25rem;
        border-bottom: 1px solid #f3f4f6;
        cursor: pointer;
        transition: background 0.2s;
        text-decoration: none;
        display: block;
        color: inherit;
      }
      .search-result-item:hover {
        background: #f9fafb;
      }
      .search-result-item:last-child {
        border-bottom: none;
      }
      .search-result-title {
        font-weight: 600;
        color: #1f2937;
        margin-bottom: 0.25rem;
      }
      .search-result-snippet {
        font-size: 0.875rem;
        color: #6b7280;
        line-height: 1.4;
      }
      .search-result-highlight {
        background: #fef3c7;
        font-weight: 500;
        color: #92400e;
      }
      .search-no-results {
        padding: 2rem;
        text-align: center;
        color: #9ca3af;
      }
      
      /* サイドバー */
      .sidebar {
        position: fixed;
        top: 61px;
        left: 0;
        width: 280px;
        height: calc(100vh - 61px);
        background: white;
        border-right: 1px solid #e5e7eb;
        overflow-y: auto;
        scrollbar-gutter: stable;
        padding: 1rem 0;
        transition: transform 0.3s ease;
      }
      .sidebar.closed {
        transform: translateX(-100%);
      }
      
      .folder-section {
        margin-bottom: 1rem;
        border-bottom: 1px solid #e5e7eb;
      }
      .folder-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        font-weight: 600;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        cursor: pointer;
        user-select: none;
        padding: 0.3rem;
        transition: background-color 0.2s;
      }
      .folder-header:hover {
        background: #f3f4f6;
      }
      .folder-icon {
        width: 14px;
        height: 14px;
        transition: transform 0.2s;
        flex-shrink: 0;
        color: #6b7280;
        transform: rotate(90deg);
      }
      .folder-icon.collapsed {
        transform: rotate(0deg);
      }
      .folder-notes {
        list-style: none;
        max-height: 1000px;
        padding-left: 0;
        margin: 0;
        overflow: hidden;
        transition: max-height 0.3s ease;
      }
      .folder-notes.collapsed {
        max-height: 0;
      }
      .folder-notes li {
        margin: 0;
        padding: 0;
      }
      .folder-notes a {
        color: #4b5563;
        text-decoration: none;
        font-size: 0.875rem;
        display: block;
        padding: 0.375rem 0.5rem;
        transition: background-color 0.2s;
      }
      .folder-notes a:hover {
        text-decoration: none;
        background: #f3f4f6;
        color: #1f2937;
      }
      .folder-notes a.active {
        background: #eef2ff;
        color: #4f46e5;
        font-weight: 600;
      }
      
      /* メインコンテンツ */
      main {
        margin-left: 280px;
        padding: 1rem;
        transition: margin-left 0.3s ease;
      }
      main.expanded {
        margin-left: 0;
      }
      
      /* オーバーレイ */
      .overlay {
        display: none;
        position: fixed;
        top: 61px;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        z-index: 80;
      }
      .overlay.show {
        display: block;
      }
      
      /* レスポンシブ */
      @media (max-width: 768px) {
        .sidebar {
          transform: translateX(-100%);
          z-index: 90;
        }
        .sidebar.open {
          transform: translateX(0);
        }
        main {
          margin-left: 0;
        }
      }
    `,
    scripts: `
      const allNoteIds = ${JSON.stringify(notes.map(n => n.id))};
      const allNotes = ${JSON.stringify(notes.map(n => ({
        id: n.id,
        title: n.title,
        content: n.content
      })))};
      
      function openRandomNote() {
        const randomId = allNoteIds[Math.floor(Math.random() * allNoteIds.length)];
        window.location.href = randomId + '.html';
      }
      
      function toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const main = document.getElementById('main');
        const overlay = document.querySelector('.overlay');
        
        sidebar.classList.toggle('closed');
        main.classList.toggle('expanded');
        
        if (window.innerWidth <= 768) {
          sidebar.classList.toggle('open');
          overlay.classList.toggle('show');
        }
      }
      
      function toggleFolder(header) {
        const icon = header.querySelector('.folder-icon');
        const notesList = header.nextElementSibling;
        
        icon.classList.toggle('collapsed');
        notesList.classList.toggle('collapsed');
      }
      
      function handleResize() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.querySelector('.overlay');
        
        if (window.innerWidth > 768) {
          sidebar.classList.remove('open');
          overlay.classList.remove('show');
        }
      }
      
      function toggleSearch() {
        const modal = document.getElementById('searchModal');
        const input = document.getElementById('searchInput');
        const isOpen = modal.classList.contains('show');
        
        if (isOpen) {
          modal.classList.remove('show');
          input.value = '';
          document.getElementById('searchResults').innerHTML = '';
        } else {
          modal.classList.add('show');
          setTimeout(() => input.focus(), 100);
        }
      }
      
      function closeSearchOnOverlay(event) {
        if (event.target.id === 'searchModal') {
          toggleSearch();
        }
      }
      
      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }
      
      function highlightText(text, query) {
        if (!query) return escapeHtml(text);
        const escapedText = escapeHtml(text);
        const parts = [];
        let remaining = escapedText;
        let lowerRemaining = remaining.toLowerCase();
        const lowerQuery = query.toLowerCase();
        
        while (true) {
          const index = lowerRemaining.indexOf(lowerQuery);
          if (index === -1) {
            parts.push(remaining);
            break;
          }
          parts.push(remaining.slice(0, index));
          parts.push('<span class="search-result-highlight">' + remaining.slice(index, index + query.length) + '</span>');
          remaining = remaining.slice(index + query.length);
          lowerRemaining = remaining.toLowerCase();
        }
        
        return parts.join('');
      }
      
      function performSearch(query) {
        const resultsDiv = document.getElementById('searchResults');
        
        if (!query.trim()) {
          resultsDiv.innerHTML = '';
          return;
        }
        
        const lowerQuery = query.toLowerCase();
        const results = allNotes
          .filter(note => {
            const titleMatch = note.title.toLowerCase().includes(lowerQuery);
            const contentMatch = note.content.toLowerCase().includes(lowerQuery);
            return titleMatch || contentMatch;
          })
          .map(note => {
            const titleMatch = note.title.toLowerCase().includes(lowerQuery);
            let snippet = note.content
              .replace(/!\[.*?\]\(.*?\)/g, '')
              .replace(/\[\[(.*?)\]\]/g, '$1')
              .replace(/#{1,6}\s/g, '')
              .replace(/\n+/g, ' ')
              .trim();
            
            if (!titleMatch) {
              const index = snippet.toLowerCase().indexOf(lowerQuery);
              const start = Math.max(0, index - 60);
              const end = Math.min(snippet.length, index + query.length + 60);
              snippet = (start > 0 ? '...' : '') + snippet.slice(start, end) + (end < snippet.length ? '...' : '');
            } else {
              snippet = snippet.slice(0, 120);
            }
            
            return { ...note, snippet };
          })
          .slice(0, 50);
        
        if (results.length === 0) {
          resultsDiv.innerHTML = '<div class="search-no-results">No results found</div>';
          return;
        }
        
        resultsDiv.innerHTML = results.map(result => 
          '<a href="' + result.id + '.html" class="search-result-item">' +
            '<div class="search-result-title">' + highlightText(result.title, query) + '</div>' +
            '<div class="search-result-snippet">' + highlightText(result.snippet, query) + '</div>' +
          '</a>'
        ).join('');
      }
      
      document.addEventListener('DOMContentLoaded', () => {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
          searchInput.addEventListener('input', (e) => {
            performSearch(e.target.value);
          });
        }
        
        // Ctrl+K or Cmd+K でサーチを開く
        document.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            toggleSearch();
          }
          if (e.key === 'Escape') {
            const modal = document.getElementById('searchModal');
            if (modal.classList.contains('show')) {
              toggleSearch();
            }
          }
        });
      });
      
      window.addEventListener('resize', handleResize);
    `
  };
}

// スニペット抽出関数（ノート生成前に定義）
function getSnippet(content) {
  return content
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[\[(.*?)\]\]/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 120);
}

// ノート生成部分を修正
notes.forEach(note => {
  const relatedNotes = findRelatedNotes(note, notes);
  const common = generateCommonHTML(note.id);
  
  const createdDate = new Date(note.metadata.created).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).replace(/\//g, '-');
  
  const updatedDate = new Date(note.metadata.updated).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).replace(/\//g, '-');
  
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${note.title} - Rhizoroji</title>
  <style>
    ${common.styles}
    
    .article-container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      padding: 2rem;
      border-radius: 0.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    a { 
      color: #60a5fa; 
      text-decoration: none; 
    }
    a:hover { 
      text-decoration: underline; 
    }
    .wiki-link {
      color: #7c3aed;
      font-weight: 500;
    }
    h1 { 
      border-bottom: 2px solid #e5e7eb; 
      padding-bottom: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .meta {
      display: flex;
      gap: 1.5rem;
      color: #6b7280;
      font-size: 0.875rem;
      margin-bottom: 2rem;
    }
    .meta-item {
      display: flex;
      align-items: center;
      gap: 0.2rem;
    }
    .meta-item svg {
      width: 16px;
      height: 16px;
      opacity: 0.7;
      margin-top: 2px;
    }
    h2 { 
      margin-top: 2rem;
      color: #1f2937;
    }
    h3 {
      margin-top: 1.5rem;
      color: #1f2937;
    }
    blockquote {
      border-left: 4px solid #d1d5db;
      padding-left: 1rem;
      margin: 0;
      color: #6b7280;
      background: #f9fafb;
      padding: 0.75rem 1rem;
      border-radius: 0 4px 4px 0;
    }
    code {
      background: #f3f4f6;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
    }
    pre {
      background: #1f2937;
      color: #e5e7eb;
      padding: 1rem;
      border-radius: 8px;
      overflow-x: auto;
      margin: 0.75rem 0;
    }
    pre code {
      background: none;
      color: inherit;
      padding: 0;
    }
    img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      margin: 1rem 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 0.75rem 0;
    }
    th, td {
      border: 1px solid #e5e7eb;
      padding: 0.5rem 1rem;
      text-align: left;
    }
    th {
      background: #f9fafb;
      font-weight: 600;
    }
    ul, ol {
      margin: 0;
      padding-left: 2rem;
    }
    ul ul, ol ol, ul ol, ol ul {
      margin: 0.25rem 0;
    }
    .task-list {
      list-style: none;
      padding-left: 0;
    }
    .task-list li {
      margin: 0.25rem 0;
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
    }
    .task-icon {
      flex-shrink: 0;
      margin-top: 0.25rem;
    }
    .task-list li.done {
      color: #9ca3af;
    }
    hr {
      border: none;
      border-top: 1px solid #e5e7eb;
      margin: 1.5rem 0;
    }
    .related { 
      margin-top: 3rem; 
      padding-top: 1.5rem; 
      border-top: 1px solid #e5e7eb; 
    }
    .related h2 { 
      font-size: 1.1rem; 
      color: #6b7280;
      margin-top: 0;
      margin-bottom: 1rem;
    }
    .related-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .related-card {
      display: block;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 0.5rem;
      padding: 1rem;
      transition: all 0.2s;
      text-decoration: none;
    }
    .related-card:hover {
      background: white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
      border-color: #c7d2fe;
      text-decoration: none;
    }
    .related-card-title {
      font-weight: 600;
      color: #1f2937;
      display: block;
      margin-bottom: 0.5rem;
      text-decoration: none;
    }
    .related-card:hover .related-card-title {
      color: #4f46e5;
    }
    .related-card-snippet {
      font-size: 0.8125rem;
      color: #6b7280;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .hub-section {
      margin-bottom: 2rem;
    }
    .hub-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.9375rem;
      font-weight: 600;
      color: #6b7280;
      margin-bottom: 1rem;
    }
    .hub-title svg {
      opacity: 0.5;
    }
    .hub-title a {
      color: #7c3aed;
      text-decoration: none;
    }
    .hub-title a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  ${common.header}
  ${common.sidebar}
  
  <main id="main">
    <div class="article-container">
      <h1>${note.title}</h1>
      <div class="meta">
        <div class="meta-item">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
            <rect x="3" y="4" width="10" height="9" rx="1" stroke-width="1.5"/>
            <path d="M5 4V2.5M11 4V2.5M3 7H13" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span>${createdDate}</span>
        </div>
        <div class="meta-item">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
            <path d="M8 14A6 6 0 108 2a6 6 0 000 12z" stroke-width="1.5"/>
            <path d="M8 5v3l2 2" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span>${updatedDate}</span>
        </div>
      </div>
      <div class="content">
        ${renderMarkdownToHTML(note.content, notes)}
      </div>
      
      ${(() => {
        const hasRelated = relatedNotes.outgoing.length > 0 || 
                          relatedNotes.backlinks.length > 0 || 
                          relatedNotes.twoHop.size > 0;
        
        if (!hasRelated) return '';
        
        const directRefs = [...relatedNotes.outgoing, ...relatedNotes.backlinks]
          .filter((n, i, self) => i === self.findIndex(s => s.title === n.title));
        
        return `
        <div class="related">
          ${directRefs.length > 0 ? `
            <h2>Direct References</h2>
            <div class="related-grid">
              ${directRefs.map(n => `
                <a href="${n.id}.html" class="related-card">
                  <div class="related-card-title">${n.title}</div>
                  <div class="related-card-snippet">${getSnippet(n.content)}</div>
                </a>
              `).join('')}
            </div>
          ` : ''}
          
          ${relatedNotes.twoHop.size > 0 ? `
            <h2>Related via...</h2>
            ${Array.from(relatedNotes.twoHop.entries()).map(([hub, connections]) => `
              <div class="hub-section">
                <div class="hub-title">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M8 3v10M3 8h10M5 5l6 6M11 5l-6 6"/>
                  </svg>
                  <a href="${hub.id}.html">${hub.title}</a>
                </div>
                <div class="related-grid">
                  ${connections.map(n => `
                    <a href="${n.id}.html" class="related-card">
                      <div class="related-card-title">${n.title}</div>
                      <div class="related-card-snippet">${getSnippet(n.content)}</div>
                    </a>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          ` : ''}
        </div>
        `;
      })()}
    </div>
  </main>
  
  <script>
    ${common.scripts}
  </script>
</body>
</html>`;
  
  fs.writeFileSync(`public/${note.id}.html`, html);
});
  
  // 作成日で降順ソート
  const sortedNotes = [...notes].sort((a, b) => b.metadata.created - a.metadata.created);

  const { folders: folderList, rootNotes } = buildFolderStructure(notes);

  // サムネイル抽出関数
  function getThumbnail(content) {
    const match = content.match(/!\[.*?\]\((.*?)\)/);
    return match ? match[1] : null;
  }

  // トップページ用の共通部品を取得
  const commonIndex = generateCommonHTML(null);

  const indexHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rhizoroji</title>
  <style>
    ${commonIndex.styles}
    
    /* ページタイトル */
    .page-header {
      margin-bottom: 2rem;
    }
    .page-header p {
      color: #6b7280;
    }
    
    /* カードグリッド */
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 1.5rem;
    }
    .card {
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 0.75rem;
      overflow: hidden;
      transition: box-shadow 0.2s, border-color 0.2s;
      display: flex;
      flex-direction: column;
      height: 220px;
      text-decoration: none;
    }
    .card:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      border-color: #c7d2fe;
    }
    .card-thumbnail {
      width: 100%;
      height: 80px;
      background: #f3f4f6;
      flex-shrink: 0;
      overflow: hidden;
    }
    .card-thumbnail img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0.9;
      transition: opacity 0.2s;
    }
    .card:hover .card-thumbnail img {
      opacity: 1;
    }
    .card-body {
      padding: 0.875rem;
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      overflow: hidden;
      position: relative;
    }
    .card-title {
      font-size: 0.9375rem;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 0.5rem;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      line-height: 1.4;
      transition: color 0.2s;
      text-decoration: none;
      word-break: break-word;
    }
    .card:hover .card-title {
      color: #4f46e5;
    }
    .card-snippet {
      font-size: 0.8125rem;
      color: #6b7280;
      line-height: 1.5;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 5;
      -webkit-box-orient: vertical;
      text-decoration: none;
      word-break: break-word;
    }
    .card.has-thumbnail .card-snippet {
      -webkit-line-clamp: 2;
    }
    .card.no-thumbnail {
      height: auto;
      min-height: 180px;
    }
    
    /* レスポンシブ（カードグリッド） */
    @media (max-width: 768px) {
      .cards-grid {
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 1rem;
      }
    }
  </style>
</head>
<body>
  ${commonIndex.header}
  ${commonIndex.sidebar}

  <main id="main">
    <div class="page-header">
      <p>${sortedNotes.length} notes published</p>
    </div>
    
    <div class="cards-grid">
      ${sortedNotes.map(note => {
        const thumbnail = getThumbnail(note.content);
        const snippet = getSnippet(note.content);
        
        return `
          <a href="${note.id}.html" class="card ${thumbnail ? 'has-thumbnail' : 'no-thumbnail'}">
            ${thumbnail ? `
              <div class="card-thumbnail">
                <img src="${thumbnail}" alt="${note.title}" loading="lazy">
              </div>
            ` : ''}
            <div class="card-body">
              <div class="card-title">${note.title}</div>
              <div class="card-snippet">${snippet || '<em style="opacity: 0.5;">No content</em>'}</div>
            </div>
          </a>
        `;
      }).join('')}
    </div>
  </main>

  <script>
    ${commonIndex.scripts}
  </script>
</body>
</html>`;

  fs.writeFileSync('public/index.html', indexHtml);
  console.log(`✅ Built ${notes.length} pages`);
}

buildSite();