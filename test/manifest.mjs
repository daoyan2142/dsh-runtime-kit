/**
 * 清单体检：`package.json` / `config.schema.json` / `patch.yml` 必须能被解析。
 *
 * 这条测试是有来由的：`package.json` 曾被写成带 BOM 的 UTF-8，JSON.parse 直接抛
 * "Unexpected token '﻿'" —— DSH 读不出 dsh.bundle / dsh.client，整个插件在
 * 插件管理器里显示成 "missing"，页面与钩子都不会出现，而且没有任何报错指向 BOM。
 *
 *   node test/manifest.mjs
 */
import { readFile } from 'node:fs/promises';

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    fail++;
    console.log(`  ✘ ${label} ${detail}`);
  }
}

const files = ['package.json', 'config.schema.json', 'patch.yml'];

console.log('\n[1] 没有 BOM');
for (const file of files) {
  const bytes = await readFile(file);
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  check(`${file} 不带 BOM`, !hasBom, hasBom ? '文件以 EF BB BF 开头' : '');
}

console.log('\n[2] JSON 可解析');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
check('package.json 解析成功', true);
check('声明了 dsh.bundle.patch', Boolean(pkg.dsh?.bundle?.patch));
check('声明了 dsh.client', pkg.dsh?.client?.platform === 'web');
check('client 入口已导出', Boolean(pkg.exports?.['./client']));
check('package.json 在 files 里带上 client.js', (pkg.files ?? []).includes('client.js'));

const schema = JSON.parse(await readFile('config.schema.json', 'utf8'));
check('config.schema.json 解析成功', true);
check('schema 含 governance 段', Boolean(schema.properties?.governance));
check('schema 含 sandbox 段', Boolean(schema.properties?.sandbox));

console.log('\n[3] patch 形状');
const patch = await readFile('patch.yml', 'utf8');
check('patch.yml 有 insert 行', /^-\s*insert:/m.test(patch));
check('patch.yml 插入的行名是 dsh-runtime-kit', patch.includes("name: 'dsh-runtime-kit'"));

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
if (fail > 0) process.exit(1);
