import { Dropbox } from 'dropbox';
import fs from 'fs';

const DROPBOX_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;

async function fetchPublishedNotes() {
  const dbx = new Dropbox({ accessToken: DROPBOX_TOKEN });
  
  console.log('📡 Fetching notes from Dropbox...');
  
  let entries = [];
  let hasMore = true;
  let cursor = null;

  while (hasMore) {
    const result = cursor 
      ? await dbx.filesListFolderContinue({ cursor })
      : await dbx.filesListFolder({ path: '', recursive: true });
    
    entries = [...entries, ...result.result.entries];
    hasMore = result.result.has_more;
    cursor = result.result.cursor;
  }

  const mdFiles = entries.filter(e => e['.tag'] === 'file' && e.name.endsWith('.md'));
  
  const publishedNotes = [];
  
  for (const entry of mdFiles) {
    const response = await dbx.filesDownload({ path: entry.path_lower });
    const blob = response.result.fileBlob;
    const text = await blob.text();
    
    const metaMatch = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)?$/);
    
    if (metaMatch) {
      const metaBlock = metaMatch[1];
      const content = metaMatch[2] || '';
      
      const metadata = {};
      metaBlock.split('\n').forEach(line => {
        const colonIndex = line.indexOf(':');
        if (colonIndex > -1) {
          const key = line.substring(0, colonIndex).trim();
          const val = line.substring(colonIndex + 1).trim();
          
          if (val === 'true') metadata[key] = true;
          else if (val === 'false') metadata[key] = false;
          else if (!isNaN(Number(val)) && key !== 'title' && key !== 'id') {
            metadata[key] = Number(val);
          } else {
            metadata[key] = val;
          }
        }
      });
      
      if (metadata.isPublished === true) {
        publishedNotes.push({
          id: metadata.id,
          title: metadata.title || entry.name.replace('.md', ''),
          content: content,
          metadata: metadata
        });
      }
    }
  }
  
  console.log(`✅ Found ${publishedNotes.length} published notes`);
  
  if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
  }
  
  fs.writeFileSync('data/notes.json', JSON.stringify(publishedNotes, null, 2));
  
  return publishedNotes;
}

fetchPublishedNotes().catch(console.error);