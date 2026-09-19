import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import nodemailer from 'nodemailer';

const MIN_HIGH_PRICE_YEN = 15000;
const STATE_PATH = process.env.STATE_PATH || 'data/takaratomymall-state.json';
const BASE_URL = 'https://takaratomymall.jp';
const args = new Set(process.argv.slice(2));

const sources = [
  {
    id: 'high_restock',
    label: '再入荷・高額',
    url: 'https://takaratomymall.jp/shop/e/eRestock/',
    minPrice: MIN_HIGH_PRICE_YEN,
    notifyFirstSeen: true,
    notifyRestock: true,
    highPriority: true,
    maxProducts: 80
  },
  {
    id: 'high_new_arrivals',
    label: '新着/予約開始・高額',
    url: 'https://takaratomymall.jp/shop/newarrival/newarrival.aspx',
    minPrice: MIN_HIGH_PRICE_YEN,
    notifyFirstSeen: true,
    notifyRestock: true,
    highPriority: true,
    maxProducts: 80
  },
  {
    id: 'duel_masters',
    label: 'デュエル・マスターズ',
    url: 'https://takaratomymall.jp/shop/c/cDM/',
    minPrice: 0,
    notifyFirstSeen: true,
    notifyRestock: true,
    newOnlyForFirstSeen: true,
    highPriority: false,
    maxProducts: 80
  }
];

async function main() {
  const previousState = await loadState();
  const nextState = {};
  const alerts = [];
  const errors = [];

  for (const source of enabledSources()) {
    try {
      const html = await fetchHtml(source);
      const products = parseProductList(html, source);

      if (products.length === 0) {
        throw new Error('商品を解析できませんでした');
      }

      for (const product of products) {
        const key = `${source.id}::${product.id}`;
        const previous = previousState[key];
        nextState[key] = product;

        if (args.has('--baseline')) continue;

        const isFirstSeen = !previous;
        const becameAvailable = previous && !previous.available && product.available;
        const statusChanged = previous && previous.status !== product.status;
        const shouldAlertFirstSeen =
          source.notifyFirstSeen &&
          isFirstSeen &&
          (!source.newOnlyForFirstSeen || product.isNew || product.available);
        const shouldAlertRestock = source.notifyRestock && (becameAvailable || statusChanged);

        if (shouldAlertFirstSeen || shouldAlertRestock) {
          alerts.push({
            source,
            product,
            reason: shouldAlertFirstSeen ? '新規検出' : '在庫/受付状態の変化',
            previousStatus: previous?.status || ''
          });
        }
      }
    } catch (error) {
      errors.push(`${source.label}: ${error.message || error}`);
    }
  }

  await saveState(nextState);

  if (args.has('--baseline')) {
    console.log(`Baseline saved. Products: ${Object.keys(nextState).length}, errors: ${errors.length}`);
    if (errors.length > 0) console.log(errors.join('\n'));
    return;
  }

  if (alerts.length === 0) {
    console.log('No Takara Tomy Mall updates.');
    if (errors.length > 0) console.log(errors.join('\n'));
    return;
  }

  const body = buildEmailBody(alerts, errors);
  console.log(body);

  if (!args.has('--dry-run')) {
    await sendMail(`タカラトミーモール更新通知 ${formatJst(new Date())}`, body);
  }
}

async function fetchHtml(source) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.PAGE_TIMEOUT_MS || 20000));

  try {
    console.log(`Fetching ${source.label}: ${source.url}`);
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'ja,en-US;q=0.9,en;q=0.8'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const bytes = new Uint8Array(await response.arrayBuffer());
    const html = decodeBestEffort(bytes, response.headers.get('content-type') || '');
    console.log(`Fetched ${source.label}: ${html.length} chars, ${Date.now() - startedAt}ms`);
    return html;
  } finally {
    clearTimeout(timer);
  }
}

function enabledSources() {
  const skipped = new Set((process.env.SKIP_SOURCE_IDS || '').split(',').map((id) => id.trim()).filter(Boolean));
  return sources.filter((source) => !skipped.has(source.id));
}

function decodeBestEffort(bytes, contentType) {
  const charset = contentType.match(/charset=([^;\s]+)/i)?.[1];
  if (charset) {
    try {
      return new TextDecoder(charset, { fatal: false }).decode(bytes);
    } catch {
      // Fall through to scoring.
    }
  }

  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const shiftJis = new TextDecoder('shift_jis', { fatal: false }).decode(bytes);
  return scoreJapanese(shiftJis) > scoreJapanese(utf8) ? shiftJis : utf8;
}

function scoreJapanese(text) {
  return (text.match(/[ぁ-んァ-ン一-龥円税込]/g) || []).length - (text.match(/�/g) || []).length * 10;
}

function parseProductList(html, source) {
  const products = [];
  const seen = new Set();
  const linkPattern =
    /<a\b[^>]*href=["']([^"']*(?:\/shop\/g\/g|\/shop\/goods\/goods\.aspx)[^"']*)["'][^>]*>([\s\S]{0,5000}?)<\/a>/gi;
  let match;

  while ((match = linkPattern.exec(html)) !== null) {
    const href = normalizeUrl(match[1]);
    const linkText = normalizeText(stripTags(match[2]));
    const surroundingHtml = html.slice(Math.max(0, match.index - 1500), match.index + 5000);
    const text = normalizeText(stripTags(surroundingHtml));

    if (!/円\s*（税込）/.test(text)) continue;

    const price = extractPrice(text);
    if (price < source.minPrice) continue;

    const id = extractProductId(href, text);
    if (seen.has(id)) continue;
    seen.add(id);

    products.push({
      id,
      name: extractName(linkText) || extractName(text),
      price,
      priceText: price ? `${price.toLocaleString('ja-JP')}円` : '',
      status: extractStatus(text),
      available: isAvailable(text),
      isNew: /\bNEW\b/i.test(text),
      isReservation: /予約/.test(text),
      releaseDate: extractReleaseDate(text),
      url: href,
      sourceId: source.id,
      sourceLabel: source.label,
      checkedAt: new Date().toISOString()
    });

    if (source.maxProducts && products.length >= source.maxProducts) break;
  }

  return products;
}

function extractName(text) {
  return text
    .replace(/\s*\d{1,3}(,\d{3})*円\s*（税込）[\s\S]*$/, '')
    .replace(/^#+\s*/, '')
    .trim();
}

function extractPrice(text) {
  const match = text.match(/(\d{1,3}(?:,\d{3})*)円\s*（税込）/);
  return match ? Number(match[1].replace(/,/g, '')) : 0;
}

function extractStatus(text) {
  const statusWords = [
    '予約する（残りわずか！）',
    'カートに入れる（残りわずか！）',
    '予約する',
    'カートに入れる',
    '抽選に応募する',
    '販売期間前',
    '販売期間終了',
    '予約期間終了',
    '在庫なし',
    '入荷案内申込'
  ];

  return statusWords.find((word) => text.includes(word)) || '';
}

function isAvailable(text) {
  return /(カートに入れる|予約する|抽選に応募する)/.test(text)
    && !/(在庫なし|販売期間前|販売期間終了|予約期間終了)/.test(text);
}

function extractReleaseDate(text) {
  const match = text.match(/発売日：([^\s]+(?:\s*[^\s]+)?)/);
  return match ? match[1].trim() : '';
}

function extractProductId(url, fallbackText) {
  const idMatch = url.match(/\/g\/([^/?#]+)/i) || url.match(/[?&]goods=([^&#]+)/i);
  if (idMatch) return decodeURIComponent(idMatch[1]);
  return Buffer.from(fallbackText).toString('base64url').slice(0, 64);
}

function buildEmailBody(alerts, errors) {
  const lines = ['タカラトミーモールで更新を検出しました。', ''];

  alerts
    .sort((a, b) => {
      if (a.source.highPriority !== b.source.highPriority) return a.source.highPriority ? -1 : 1;
      return b.product.price - a.product.price;
    })
    .forEach((alert) => {
      const product = alert.product;
      lines.push(`[${alert.source.label}] ${alert.reason}`);
      lines.push(product.name);
      lines.push(`価格: ${product.priceText}`);
      lines.push(`状態: ${product.status}${alert.previousStatus ? `（前回: ${alert.previousStatus}）` : ''}`);
      if (product.releaseDate) lines.push(`発売日: ${product.releaseDate}`);
      lines.push(product.url);
      lines.push('');
    });

  if (errors.length > 0) {
    lines.push('取得エラー:');
    errors.forEach((error) => lines.push(`- ${error}`));
  }

  return lines.join('\n');
}

async function sendMail(subject, body) {
  const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_TO'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`メール送信設定が不足しています: ${missing.join(', ')}`);
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.MAIL_TO,
    subject,
    text: body
  });
}

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function saveState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

function normalizeUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${BASE_URL}${url}`;
  return `${BASE_URL}/${url.replace(/^\.?\//, '')}`;
}

function normalizeText(text) {
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ');
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function formatJst(date) {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
