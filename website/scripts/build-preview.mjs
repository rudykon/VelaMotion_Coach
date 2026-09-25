import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseDocument } from 'htmlparser2';
import { parseExpressionAt } from 'acorn';
import { build } from 'esbuild';

// Compile only the UX subset actually used by this project. Unknown constructs
// fail the build instead of silently dropping controls from the preview.
export function expression(source) {
  const ast = parseExpressionAt(source, 0, { ecmaVersion: 'latest' });
  if (source.slice(ast.end).trim()) throw new Error(`Unsupported UX expression: ${source}`);
  const roots = new Set();
  function visit(node) {
    if (!node) return;
    switch (node.type) {
      case 'Identifier': if (!['undefined', '$item', '$idx'].includes(node.name)) roots.add(node.name); break;
      case 'Literal': break;
      case 'MemberExpression': visit(node.object); if (node.computed) visit(node.property); break;
      case 'UnaryExpression': visit(node.argument); break;
      case 'BinaryExpression': case 'LogicalExpression': visit(node.left); visit(node.right); break;
      case 'ConditionalExpression': visit(node.test); visit(node.consequent); visit(node.alternate); break;
      default: throw new Error(`Unsupported UX expression node: ${node.type}`);
    }
  }
  visit(ast);
  return `(vm,scope)=>{const {${[...roots].join(',')}}=vm;const {$item,$idx}=scope;return (${source});}`;
}
function binding(value) {
  const parts = []; let offset = 0;
  for (const match of value.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    if (match.index > offset) parts.push(JSON.stringify(value.slice(offset, match.index)));
    parts.push(`String((${expression(match[1].trim())})(vm,scope) ?? '')`);
    offset = match.index + match[0].length;
  }
  if (offset < value.length) parts.push(JSON.stringify(value.slice(offset)));
  return `(vm,scope)=>${parts.join('+') || '""'}`;
}
function directive(value) {
  const match = /^\s*\{\{([\s\S]*?)\}\}\s*$/.exec(value);
  if (!match) throw new Error('UX directive must contain one expression');
  return expression(match[1].trim());
}
export function compileTemplate(template) {
  const tags = new Set(['div', 'text', 'input', 'list', 'list-item']);
  function convert(node) {
    if (node.type === 'comment') return null;
    if (node.type === 'text') return node.data.trim() ? `{text:${binding(node.data.trim())}}` : null;
    if (node.type !== 'tag' || !tags.has(node.name)) throw new Error(`Unsupported UX tag: ${node.name}`);
    const attrs = [], events = [], fields = [];
    for (const [key, value] of Object.entries(node.attribs)) {
      if (key === 'if' || key === 'show' || key === 'for') { fields.push(`${key === 'for' ? 'each' : key}:${directive(value)}`); continue; }
      if (['ontouchstart', 'ontouchmove', 'ontouchend'].includes(key)) {
        const match = /^(\w+)(?:\('([\w]+)'\))?$/.exec(value);
        if (!match) throw new Error(`Unsupported UX event: ${value}`);
        events.push(`${JSON.stringify(key.slice(2))}:(vm,scope,event)=>vm[${JSON.stringify(match[1])}](${match[2] ? JSON.stringify(match[2])+',' : ''}event)`);
        continue;
      }
      if (!['class', 'style', 'type', 'value'].includes(key)) throw new Error(`Unsupported UX attribute: ${key}`);
      attrs.push(`${JSON.stringify(key)}:${binding(value)}`);
    }
    return `{tag:${JSON.stringify(node.name)},attrs:{${attrs}},events:{${events}},${fields.length ? fields.join(',')+',' : ''}children:[${node.children.map(convert).filter(Boolean).join(',')}]}`;
  }
  return `[${parseDocument(template, { xmlMode: true, decodeEntities: true }).children.map(convert).filter(Boolean).join(',')}]`;
}
export async function buildPreview(root, repo) {
  const sourcePath = path.join(repo, 'quickapp/velamotion_coach/src/pages/index/index.ux');
  const source = await fs.readFile(sourcePath, 'utf8');
  const sections = Object.fromEntries(['template','script','style'].map(tag => {
    const match = source.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    if (!match) throw new Error(`Missing UX ${tag}`);
    return [tag, match[1]];
  }));
  const output = path.join(root, 'dist/preview');
  await fs.mkdir(output, { recursive: true });
  const result = await build({
    absWorkingDir: repo,
    entryPoints: [path.join(root, 'preview/entry.js')],
    outfile: path.join(output, 'app.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    minify: true, sourcemap: false, metafile: true, legalComments: 'none',
    plugins: [{ name: 'project-ux-preview', setup(api) {
      api.onResolve({ filter: /^project:page$/ }, () => ({ path: sourcePath, namespace: 'ux-page' }));
      api.onLoad({ filter: /.*/, namespace: 'ux-page' }, () => ({ contents: sections.script, resolveDir: path.dirname(sourcePath) }));
      api.onResolve({ filter: /^project:template$/ }, () => ({ path: 'template', namespace: 'ux-template' }));
      api.onLoad({ filter: /.*/, namespace: 'ux-template' }, () => ({ contents: `export default ${compileTemplate(sections.template)};` }));
      api.onResolve({ filter: /^@(system|service)\./ }, args => ({ path: args.path, namespace: 'browser-features' }));
      api.onLoad({ filter: /.*/, namespace: 'browser-features' }, args => ({ contents: args.path === '@system.storage'
        ? `export {default} from ${JSON.stringify(path.join(root, 'preview/storage.js'))};`
        : 'module.exports = null;', resolveDir: root }));
    } }],
  });
  await fs.writeFile(path.join(output, 'page.css'), sections.style);
  const files = Object.keys(result.metafile.inputs).filter(p => p.startsWith('quickapp/')).sort();
  const digest = createHash('sha256').update(source);
  for (const file of files) digest.update(await fs.readFile(path.join(repo, file)));
  await fs.writeFile(path.join(output, 'source-info.json'), JSON.stringify({
    mode: 'ux-source-compatibility-preview', source: 'quickapp/velamotion_coach/src/pages/index/index.ux',
    uxSha256: createHash('sha256').update(source).digest('hex'), sourceSha256: digest.digest('hex'),
    runtime: 'browser DOM + project JavaScript + WebAssembly classifier', rpkRuntime: false,
    coordinateSpace: { width: 480, height: 554 }, input: 'project MockSensorProvider; no physical sensors',
    storage: 'page memory only', modules: files,
  }, null, 2)+'\n');
  console.log(`Built UX source preview (${files.length} original project modules).`);
}
