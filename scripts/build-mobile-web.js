'use strict';

// 모바일 앱에 넣을 웹 파일(public → www)을 복사한다.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const from = path.join(root, 'public');
const to = path.join(root, 'www');

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });

// 백그라운드 러너(방송 시작 알림) 스크립트 → 앱 번들의 runners/ 폴더
fs.mkdirSync(path.join(to, 'runners'), { recursive: true });
fs.copyFileSync(path.join(root, 'mobile', 'runner.js'), path.join(to, 'runners', 'runner.js'));
console.log('www 폴더를 만들었어요.');
