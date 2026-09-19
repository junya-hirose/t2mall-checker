const urls = [
  'https://takaratomymall.jp/shop/e/eRestock/',
  'https://takaratomymall.jp/shop/newarrival/newarrival.aspx',
  'https://takaratomymall.jp/shop/c/cDM/'
];

for (const url of urls) {
  console.log(`\n## ${url}`);
  const bytes = await fetchBytes(url);
  const decoded = decodeBestEffort(bytes);
  console.log(`chars: ${decoded.length}`);

  for (const marker of [
    'goods_list_auto_load_area',
    'auto_load',
    'conditioncountapi',
    'treecountapi',
    'CategoryTags',
    'data-goods',
    'next',
    'page',
    'ajax'
  ]) {
    printContexts(decoded, marker, 500);
  }

  const scripts = [...decoded.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((script) => /(ajax|goods_list|auto|api|page|condition|tree|CategoryTags)/i.test(script));

  console.log('\ninline scripts');
  scripts.slice(0, 10).forEach((script, index) => {
    console.log(`-- script ${index + 1}`);
    console.log(compact(script).slice(0, 1800));
  });
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ja,en-US;q=0.9,en;q=0.8'
    }
  });
  return new Uint8Array(await response.arrayBuffer());
}

function decodeBestEffort(bytes) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const shiftJis = new TextDecoder('shift_jis', { fatal: false }).decode(bytes);
  return scoreJapanese(shiftJis) > scoreJapanese(utf8) ? shiftJis : utf8;
}

function scoreJapanese(text) {
  return (text.match(/[ぁ-んァ-ン一-龥円税込]/g) || []).length - (text.match(/�/g) || []).length * 10;
}

function printContexts(text, marker, radius) {
  let index = text.indexOf(marker);
  let count = 0;
  while (index !== -1 && count < 3) {
    console.log(`\nmarker: ${marker}`);
    console.log(compact(text.slice(Math.max(0, index - radius), index + radius)));
    index = text.indexOf(marker, index + marker.length);
    count++;
  }
}

function compact(value) {
  return value.replace(/\s+/g, ' ').trim();
}
