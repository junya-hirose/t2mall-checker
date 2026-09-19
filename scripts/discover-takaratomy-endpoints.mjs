const urls = [
  'https://takaratomymall.jp/shop/e/eRestock/',
  'https://takaratomymall.jp/shop/newarrival/newarrival.aspx',
  'https://takaratomymall.jp/shop/c/cDM/'
];

for (const url of urls) {
  console.log(`\n## ${url}`);
  try {
    const html = await fetchText(url);
    console.log(`bytes: ${Buffer.byteLength(html)}`);

    const attrs = findAll(html, /\b(?:src|href|action)=["']([^"']+)["']/gi)
      .map((match) => absolutize(match[1], url));
    const interesting = attrs.filter((value) =>
      /\.(?:js|json)(?:[?#].*)?$/i.test(value) ||
      /(?:ajax|api|goods|search|item|product|stock|zaiko|recommend|cart|favorite)/i.test(value)
    );

    console.log('\nassets/actions');
    printUnique(interesting, 120);

    console.log('\ninline candidates');
    printUnique(findAll(html, /["']([^"']*(?:ajax|api|json|goods|search|item|product|stock|zaiko|recommend)[^"']*)["']/gi)
      .map((match) => absolutize(match[1], url)), 120);

    console.log('\nforms');
    printUnique(findAll(html, /<form\b[\s\S]*?<\/form>/gi)
      .map((match) => compactText(match[0]).slice(0, 500)), 20);
  } catch (error) {
    console.error(error.message || error);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'ja,en-US;q=0.9,en;q=0.8'
      }
    });
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function findAll(text, pattern) {
  const matches = [];
  let match;
  while ((match = pattern.exec(text)) !== null) matches.push(match);
  return matches;
}

function printUnique(values, limit) {
  [...new Set(values)].slice(0, limit).forEach((value) => console.log(value));
}

function absolutize(value, baseUrl) {
  if (!value || /^(?:javascript:|mailto:|tel:|#)/i.test(value)) return value;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function compactText(value) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
