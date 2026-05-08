import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2] || '.';
const output = process.argv[3] || 'catalog.json';
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function cleanText(value) {
  return value
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function normalizeSearch(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stripDecorativePrefix(value) {
  return value.replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

function encodePath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

function buildTags(text, folderName) {
  const tags = new Set(['edital pronto']);
  const source = normalizeSearch(`${text} ${folderName}`);
  if (source.includes('pre-edital')) tags.add('pre-edital');
  if (source.includes('nivel medio')) tags.add('nivel medio');
  if (source.includes('cebraspe')) tags.add('cebraspe');
  if (source.includes('fgv')) tags.add('fgv');
  if (source.includes('inss')) tags.add('inss');
  return [...tags];
}

function parseInfo(text, folderName, jsonName) {
  const cleaned = cleanText(text);
  const lines = cleaned.split('\n');
  const titleLine = lines[0] || folderName;
  const cargoLine = lines[1] || titleLine;
  const descriptionLine = lines[2] || cargoLine;
  const bancaYearLine = lines[3] || '';
  const simpleBancaMatch = bancaYearLine.match(/\b([A-Z]{3,}(?:\s+[A-Z]{2,})*)\s+(20\d{2})\b/);
  const yearMatch = bancaYearLine.match(/\b(20\d{2})\b/);

  return {
    titulo: stripDecorativePrefix(titleLine),
    orgao: stripDecorativePrefix(titleLine),
    banca: simpleBancaMatch?.[1]?.trim() || 'A definir',
    cargo: stripDecorativePrefix(cargoLine),
    ano: yearMatch ? Number(yearMatch[1]) : new Date().getFullYear(),
    tags: buildTags(cleaned, folderName),
    descricao: stripDecorativePrefix(descriptionLine),
    arquivoNome: jsonName,
  };
}

async function main() {
  const folders = await readdir(root, { withFileTypes: true });
  const editais = [];

  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    if (folder.name.startsWith('.') || folder.name === 'scripts' || folder.name === 'node_modules') continue;

    const folderPath = path.join(root, folder.name);
    const files = await readdir(folderPath, { withFileTypes: true });
    const jsonFile = files.find((file) => file.isFile() && path.extname(file.name).toLowerCase() === '.json');
    const imageFile = files.find((file) => file.isFile() && imageExtensions.has(path.extname(file.name).toLowerCase()));
    const textFile = files.find((file) => file.isFile() && file.name.toLowerCase().endsWith('.txt'));

    if (!jsonFile || !imageFile || !textFile) continue;

    const text = await readFile(path.join(folderPath, textFile.name), 'utf8');
    const info = parseInfo(text, folder.name, jsonFile.name);
    const folderUrl = encodePath(folder.name);

    editais.push({
      id: slugify(folder.name),
      titulo: info.titulo,
      orgao: info.orgao,
      banca: info.banca,
      cargo: info.cargo,
      ano: info.ano,
      tags: info.tags,
      descricao: info.descricao,
      imagem: `${folderUrl}/${encodeURIComponent(imageFile.name)}`,
      arquivo: `${folderUrl}/${encodeURIComponent(jsonFile.name)}`,
      arquivoNome: info.arquivoNome,
    });
  }

  editais.sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));

  await writeFile(
    output,
    `${JSON.stringify({ atualizadoEm: new Date().toISOString(), editais }, null, 2)}\n`,
    'utf8',
  );

  console.log(`Catalogo gerado com ${editais.length} edital(is): ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
