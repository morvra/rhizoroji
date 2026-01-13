import { Dropbox } from 'dropbox';
import fetch from 'node-fetch';
import fs from 'fs';

// 前回のビルド情報を保存するファイル
const BUILD_CACHE_FILE = 'data/build-cache.json';

// キャッシュから前回のハッシュ情報を読み込む
function loadBuildCache() {
  if (fs.existsSync(BUILD_CACHE_FILE)) {
    try {
      const cache = JSON.parse(fs.readFileSync(BUILD_CACHE_FILE, 'utf-8'));
      console.log(`📦 Loaded cache from ${new Date(cache.lastBuild).toLocaleString()}`);
      return cache;
    } catch (e) {
      console.log('⚠️  Failed to load build cache, rebuilding all notes');
      return { fileHashes: {}, publishStates: {}, noteIds: [], lastBuild: null };
    }
  }
  console.log('📦 No cache found, building from scratch');
  return { fileHashes: {}, publishStates: {}, noteIds: [], lastBuild: null };
}

// キャッシュを保存
function saveBuildCache(cache) {
  if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
  }
  fs.writeFileSync(BUILD_CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log('💾 Saved build cache');
}

async function fetchNotes() {
  console.log('🔍 Fetching notes from Dropbox...');
  
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const clientId = '2reog117jgm9gmw';

  if (!refreshToken) {
    console.error('❌ DROPBOX_REFRESH_TOKEN is not set');
    process.exit(1);
  }

  const dbx = new Dropbox({
    refreshToken,
    clientId,
    fetch
  });

  if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
  }

  // 前回のビルド情報を読み込む
  const buildCache = loadBuildCache();
  const previousHashes = buildCache.fileHashes || {};
  const previousPublishStates = buildCache.publishStates || {}; // 追加
  const previousNoteIds = new Set(buildCache.noteIds || []);
  
  // 既存の notes.json を読み込む（変更がなかったノートを再利用）
  let existingNotesMap = new Map();
  if (fs.existsSync('data/notes.json')) {
    try {
      const existingNotes = JSON.parse(fs.readFileSync('data/notes.json', 'utf-8'));
      existingNotes.forEach(note => {
        existingNotesMap.set(note.id, note);
      });
      console.log(`📖 Loaded ${existingNotes.length} existing notes`);
    } catch (e) {
      console.log('⚠️  Failed to load existing notes.json');
    }
  }
  
  const notes = [];
  const newHashes = {};
  const newPublishStates = {}; // 追加
  const currentNoteIds = new Set();
  const processedPaths = new Map(); // path -> noteId のマッピング
  const skippedPublishedPaths = []; // スキップされた公開ノートのパス
  
  let hasMore = true;
  let cursor = null;
  let changedCount = 0;
  let skippedCount = 0;
  let skippedUnpublishedCount = 0; // 追加
  let newCount = 0;
  let totalFiles = 0;

  try {
    while (hasMore) {
      let response;
      
      if (!cursor) {
        response = await dbx.filesListFolder({ path: '', recursive: true });
      } else {
        response = await dbx.filesListFolderContinue({ cursor });
      }

      // 全ファイルのメタデータを取得（本体はまだダウンロードしない）
      for (const entry of response.result.entries) {
        if (entry['.tag'] !== 'file' || !entry.name.endsWith('.md')) {
          continue;
        }

        totalFiles++;
        const filePath = entry.path_display;
        const contentHash = entry.content_hash;
        const isNewFile = !previousHashes[filePath];
        
        // ハッシュが変わっていない場合
        if (previousHashes[filePath] === contentHash) {
          // 前回 isPublished: false だった場合はスキップ
          if (previousPublishStates[filePath] === false) {
            skippedUnpublishedCount++;
            newHashes[filePath] = contentHash;
            newPublishStates[filePath] = false;
            continue;
          }
          
          // 前回 isPublished: true だった場合も、変更がないのでスキップ
          skippedCount++;
          skippedPublishedPaths.push(filePath); // パスを記録
          
          // ハッシュと公開状態を保存
          newHashes[filePath] = contentHash;
          newPublishStates[filePath] = true;
          continue;
        }

        // 変更があったファイルまたは新規ファイルをダウンロード
        if (isNewFile) {
          newCount++;
          console.log(`✨ New file: ${entry.name}`);
        } else {
          changedCount++;
          console.log(`📝 Changed: ${entry.name}`);
        }

        let fileContent;
        try {
          const download = await dbx.filesDownload({ path: entry.path_lower });
          
          if (download.result.fileBlob) {
            fileContent = await download.result.fileBlob.text();
          } else if (download.result.fileBinary) {
            fileContent = download.result.fileBinary.toString('utf-8');
          } else {
            fileContent = Buffer.from(download.result).toString('utf-8');
          }
        } catch (downloadError) {
          console.error(`⚠️  Failed to download ${entry.name}:`, downloadError.message);
          continue;
        }

        // Frontmatter解析
        const frontmatterMatch = fileContent.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
          console.log(`⚠️  No frontmatter in ${entry.name}, skipping`);
          continue;
        }

        const frontmatter = {};
        frontmatterMatch[1].split('\n').forEach(line => {
          const [key, ...valueParts] = line.split(':');
          if (key && valueParts.length > 0) {
            const value = valueParts.join(':').trim();
            if (value === 'true') frontmatter[key.trim()] = true;
            else if (value === 'false') frontmatter[key.trim()] = false;
            else if (!isNaN(value)) frontmatter[key.trim()] = Number(value);
            else frontmatter[key.trim()] = value;
          }
        });

        // isPublished が true のノートのみ
        if (frontmatter.isPublished !== true) {
          console.log(`⏭️  ${entry.name} is not published, skipping`);
          // 未公開状態をキャッシュに記録（次回スキップ可能に）
          newHashes[filePath] = contentHash;
          newPublishStates[filePath] = false;
          continue;
        }

        const content = fileContent.replace(/^---\n[\s\S]*?\n---\n/, '');
        const pathParts = entry.path_display.split('/').filter(p => p && p !== entry.name);
        const folderName = pathParts.length > 0 ? pathParts[0] : null;

        const note = {
          id: frontmatter.id || entry.name.replace('.md', ''),
          title: frontmatter.title || entry.name.replace('.md', ''),
          content: content,
          folderName: folderName,
          metadata: {
            created: frontmatter.created || Date.now(),
            updated: frontmatter.updated || Date.now(),
            isBookmarked: frontmatter.isBookmarked || false,
            isPublished: frontmatter.isPublished || false
          }
        };

        notes.push(note);
        currentNoteIds.add(note.id);
        processedPaths.set(filePath, note.id);
        newHashes[filePath] = contentHash;
        newPublishStates[filePath] = true; // 公開状態を記録
      }

      hasMore = response.result.has_more;
      cursor = response.result.cursor;
    }

    // スキップされた公開ノートを既存データから復元
    skippedPublishedPaths.forEach(filePath => {
      // パスからファイル名とフォルダ名を抽出
      const pathParts = filePath.split('/').filter(p => p);
      const fileName = pathParts[pathParts.length - 1].replace('.md', '');
      const folderName = pathParts.length > 1 ? pathParts[0] : null;
      
      // 既存ノートから一致するものを探す
      const existingNote = Array.from(existingNotesMap.values()).find(n => {
        // ファイル名とフォルダ名が一致するか、IDが一致するかで判定
        const fileNameMatches = n.id === fileName || n.title === fileName;
        const folderMatches = n.folderName === folderName;
        return fileNameMatches && folderMatches;
      });
      
      if (existingNote) {
        // すでに追加されていないか確認
        if (!notes.find(n => n.id === existingNote.id)) {
          notes.push(existingNote);
          currentNoteIds.add(existingNote.id);
        }
      } else {
        console.log(`⚠️  Warning: Could not find existing note for ${filePath}`);
      }
    });

    // 削除されたノートの検出
    const deletedNoteIds = Array.from(previousNoteIds).filter(id => !currentNoteIds.has(id));
    if (deletedNoteIds.length > 0) {
      console.log(`🗑️  Deleted notes: ${deletedNoteIds.join(', ')}`);
    }

    // notes.json を保存
    fs.writeFileSync('data/notes.json', JSON.stringify(notes, null, 2));
    
    // ビルドキャッシュを保存
    saveBuildCache({
      fileHashes: newHashes,
      publishStates: newPublishStates, // 追加
      noteIds: Array.from(currentNoteIds),
      lastBuild: Date.now()
    });

    console.log('');
    console.log('📊 Summary:');
    console.log(`   Total markdown files: ${totalFiles}`);
    console.log(`   ✨ New files: ${newCount}`);
    console.log(`   📝 Changed files: ${changedCount}`);
    console.log(`   ⏭️  Skipped (unchanged & published): ${skippedCount}`);
    console.log(`   🔒 Skipped (unchanged & unpublished): ${skippedUnpublishedCount}`);
    console.log(`   📝 Published notes: ${notes.length}`);
    if (deletedNoteIds.length > 0) {
      console.log(`   🗑️  Deleted notes: ${deletedNoteIds.length}`);
    }
    
    const totalSkipped = skippedCount + skippedUnpublishedCount;
    const savedBandwidth = totalSkipped > 0 
      ? `Saved ~${(totalSkipped * 0.1).toFixed(1)}MB bandwidth` 
      : 'First build';
    console.log(`   💡 ${savedBandwidth}`);
    console.log('');
    console.log('✅ Fetch completed successfully');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fetchNotes();