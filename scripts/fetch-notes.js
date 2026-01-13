import { Dropbox } from 'dropbox';
import fs from 'fs';

const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;
const CLIENT_ID = '2reog117jgm9gmw';

async function fetchPublishedNotes() {
  // Refresh Tokenがあればそれを使う
  const dbx = DROPBOX_REFRESH_TOKEN 
    ? new Dropbox({ 
        clientId: CLIENT_ID,
        refreshToken: DROPBOX_REFRESH_TOKEN 
      })
    : new Dropbox({ accessToken: DROPBOX_ACCESS_TOKEN });
  
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
  console.log(`Found ${mdFiles.length} markdown files`);
  
  const publishedNotes = [];
  
  for (const entry of mdFiles) {
    try {
      const response = await dbx.filesDownload({ path: entry.path_lower });
      const result = response.result;
      
      // text を取得する複数の方法を試す
      let text;
      
      if (result.fileBlob) {
        text = await result.fileBlob.text();
      } else if (result.fileBinary) {
        text = result.fileBinary.toString('utf-8');
      } else if (Buffer.isBuffer(result)) {
        text = result.toString('utf-8');
      } else {
        console.warn(`⚠️  Unknown response format for ${entry.path_lower}`);
        continue;
      }
      
      console.log(`✓ Downloaded: ${entry.name} (${text.length} chars)`);
      
      // メタデータ解析
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
        
        // isPublished が true のものだけ
        if (metadata.isPublished === true) {
          // パスからフォルダ名を取得（最初のフォルダのみ）
          const pathParts = entry.path_lower.split('/').filter(p => p);
          const folderName = pathParts.length > 1 ? pathParts[0] : null;
          
          publishedNotes.push({
            id: metadata.id,
            title: metadata.title || entry.name.replace('.md', ''),
            content: content,
            folderName: folderName,
            metadata: metadata
          });
          console.log(`  → Published: ${metadata.title || entry.name}`);
        }
      }
      
    } catch (error) {
      console.error(`❌ Failed to download ${entry.path_lower}:`, error.message);
      continue;
    }
  }
  
  console.log(`\n✅ Found ${publishedNotes.length} published notes`);
  
  if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
  }
  
  fs.writeFileSync('data/notes.json', JSON.stringify(publishedNotes, null, 2));
  
  return publishedNotes;
}

fetchPublishedNotes().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
