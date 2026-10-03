import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// Explicit capabilities, not an exemption for every file importing Supabase.
export const authFiles = new Set([
  'src/app/modules/admin/auth/data/authRepo.ts',
  'src/app/modules/admin/auth/pages/AdminResetPasswordPage.tsx',
  'src/app/modules/admin/profile/components/ProfilePanel/ProfilePanel.tsx',
  'src/app/providers/AuthProvider/AuthProvider.tsx',
  'src/app/modules/platform/security/PlatformSecurity.tsx',
  'src/app/modules/platform/auth/PlatformMfaPage.tsx',
  'src/app/modules/platform/auth/platformMfaEnrollment.ts',
  'src/shared/gateways/supabase/signOutFromBrowser.ts',
]);
// No browser Storage SDK consumers currently remain. Public asset URLs and
// Edge-managed uploads/downloads do not require a Storage SDK exception.
export const storageFiles = new Set();

export function inspectSource(path, source) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true,
    path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const errors = [];
  const literal = (node) => node && (ts.isStringLiteralLike(node) ? node.text : undefined);
  function property(node) {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node)) return literal(node.argumentExpression);
  }
  function chain(node) {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      return [...chain(node.expression), property(node)];
    }
    return ts.isIdentifier(node) ? [node.text] : [];
  }
  function reject(node, reason) {
    const position = file.getLineAndCharacterOfPosition(node.getStart(file));
    errors.push(`${path}:${position.line + 1}: ${reason}`);
  }
  function visit(node) {
    const name = property(node);
    if (name) {
      const parts = chain(node);
      if (['rpc', 'channel', 'schema', 'rest', 'realtime'].includes(name)) {
        reject(node, `direct business capability ${name} is forbidden; use an explicit Edge route`);
      }
      if (name === 'from') {
        const standard = parts.length === 2 && ['Array', 'Buffer', 'Uint8Array'].includes(parts[0]);
        const storage = parts.includes('storage') && storageFiles.has(path);
        if (!standard && !storage) reject(node, 'Data API from() is forbidden');
      }
      if (name === 'auth' && !authFiles.has(path)) reject(node, 'Auth capability outside the explicit allowlist');
      if (name === 'storage' && !storageFiles.has(path)) reject(node, 'Storage capability outside the explicit allowlist');
    }
    if (ts.isBindingElement(node) && ['rpc', 'from', 'channel', 'realtime', 'storage'].includes(node.propertyName?.getText(file) ?? node.name.getText(file))) {
      reject(node, 'destructured direct data capability is forbidden');
    }
    // Catches raw fetch/XHR endpoints, including fragments in concatenated URLs.
    // Comments, types and imports are AST nodes, not text matched indiscriminately.
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      && /\/(?:rest|graphql)\/v1(?:\b|\/)|\/realtime\/v1/.test(node.text)) {
      reject(node, 'raw Data API/GraphQL/Realtime URL is forbidden');
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return errors;
}

export function checkBrowserBoundary(root = process.cwd()) {
  const errors = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        errors.push(...inspectSource(relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')));
      }
    }
  }
  for (const directory of ['src', 'netlify']) walk(resolve(root, directory));
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const errors = checkBrowserBoundary();
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('PASS browser boundary: no business Data API; explicit Auth/Storage allowlist');
}
