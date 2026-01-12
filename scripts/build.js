import fs from 'fs';

function renderMarkdownToHTML(content, allNotes) {
  let html = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/~~(.*?)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\n/g, '<br>');
  
  html = html.replace(/\[\[(.*?)\]\]/g, (match, title) => {
    const target = allNotes.find(n => n.title === title);
    return target 
      ? `<a href="${target.id}.html">${title}</a>`
      : title;
  });
  
  return html;
}

function findRelatedNotes(note, allNotes) {
  const related = [];
  
  allNotes.forEach(other => {
    if (other.id === note.id) return;
    const regex = new RegExp(`\\[\\[${note.title}\\]\\]`);
    if (regex.test(other.content)) {
      related.push(other);
    }
  });
  
  return related;
}

function buildSite() {
  console.log('🏗️  Building static site...');
  
  const notes = JSON.parse(fs.readFileSync('data/notes.json', 'utf-8'));
  
  if (!fs.existsSync('public')) {
    fs.mkdirSync('public');
  }
  
  notes.forEach(note => {
    const relatedNotes = findRelatedNotes(note, notes);
    
    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${note.title}</title>
  <style>
    body {
      max-width: 800px;
      margin: 40px auto;
      padding: 0 20px;
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1.6;
      color: #374151;
    }
    a { 
      color: #4f46e5; 
      text-decoration: none; 
    }
    a:hover { 
      text-decoration: underline; 
    }
    h1 { 
      border-bottom: 2px solid #e5e7eb; 
      padding-bottom: 0.5rem;
      margin-bottom: 1.5rem;
    }
    h2 { 
      margin-top: 2rem;
      color: #1f2937;
    }
    code {
      background: #f3f4f6;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
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
    }
    .related ul {
      list-style: none;
      padding: 0;
    }
    .related li {
      margin: 0.5rem 0;
    }
  </style>
</head>
<body>
  <h1>${note.title}</h1>
  <div class="content">
    ${renderMarkdownToHTML(note.content, notes)}
  </div>
  
  ${relatedNotes.length > 0 ? `
  <div class="related">
    <h2>Related Notes</h2>
    <ul>
      ${relatedNotes.map(r => `<li><a href="${r.id}.html">${r.title}</a></li>`).join('')}
    </ul>
  </div>
  ` : ''}
</body>
</html>`;
    
    fs.writeFileSync(`public/${note.id}.html`, html);
  });
  
  const indexHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Digital Garden</title>
  <style>
    body {
      max-width: 800px;
      margin: 40px auto;
      padding: 0 20px;
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1.6;
    }
    h1 { border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    ul { list-style: none; padding: 0; }
    li { margin: 1rem 0; }
    a { color: #4f46e5; text-decoration: none; font-size: 1.1rem; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>My Digital Garden 🌱</h1>
  <ul>
    ${notes.map(n => `<li><a href="${n.id}.html">${n.title}</a></li>`).join('')}
  </ul>
</body>
</html>`;
  
  fs.writeFileSync('public/index.html', indexHtml);
  
  console.log(`✅ Built ${notes.length} pages`);
}

buildSite();