#!/usr/bin/env node
// ===== 世界书数据库备份脚本 =====
// 用法: node scripts/backup.js [备份目录]
// 默认备份到项目根目录下的 backups/,保留最近 14 份,超过自动清理最旧的。
// 可用 cron 定时执行,例如每天凌晨 3 点:
//   0 3 * * * cd /home/ubuntu/World\ Book\ Editor && /usr/bin/node scripts/backup.js >> backups/backup.log 2>&1
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const src = process.env.WBE_DB || path.join(root, 'world-books.db');
const backupDir = process.argv[2] || path.join(root, 'backups');
const KEEP = 14;

if (!fs.existsSync(src)) {
  console.log('[' + new Date().toISOString() + '] 数据库不存在，跳过: ' + src);
  process.exit(0);
}

fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = path.join(backupDir, 'world-books-' + stamp + '.db');

try {
  // better-sqlite3 的 backup API 生成一致快照（WAL 模式下也安全）
  const db = new Database(src, { readonly: true });
  db.backup(dest).then(() => {
    db.close();
    // 清理旧备份，保留最近 KEEP 份
    const files = fs.readdirSync(backupDir)
      .filter(f => /^world-books-\d{4}-\d{2}-\d{2}T.*\.db$/.test(f))
      .sort();
    while (files.length > KEEP) {
      const old = files.shift();
      fs.unlinkSync(path.join(backupDir, old));
      console.log('[' + new Date().toISOString() + '] 已清理旧备份: ' + old);
    }
    const size = (fs.statSync(dest).size / 1024).toFixed(1);
    console.log('[' + new Date().toISOString() + '] 备份完成: ' + dest + ' (' + size + ' KB)');
  }).catch(err => {
    console.error('[' + new Date().toISOString() + '] 备份失败: ' + err.message);
    process.exit(1);
  });
} catch (err) {
  console.error('[' + new Date().toISOString() + '] 备份失败: ' + err.message);
  process.exit(1);
}
