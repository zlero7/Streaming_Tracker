'use strict';

// 모바일 앱에 넣을 웹 파일(public → www)을 복사한다.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const from = path.join(root, 'public');
const to = path.join(root, 'www');

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log('www 폴더를 만들었어요.');
