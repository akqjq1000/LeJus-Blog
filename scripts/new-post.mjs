// 사용법: npm run new -- "포스트 제목"
import { writeFileSync, existsSync } from 'node:fs';

const title = process.argv.slice(2).join(' ').trim();
if (!title) {
  console.error('사용법: npm run new -- "포스트 제목"');
  process.exit(1);
}
const date = new Date().toISOString().slice(0, 10);
const slug = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
const file = `src/content/posts/${date}-${slug}.md`;
if (existsSync(file)) {
  console.error(`이미 존재합니다: ${file}`);
  process.exit(1);
}
writeFileSync(file, `---
title: "${title.replace(/"/g, '\\"')}"
description: ""
date: ${date}
category: Note
tags: []
draft: true
---

`);
console.log(`생성됨: ${file}`);
