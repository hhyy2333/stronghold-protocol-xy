import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { assetCdnOrigins, siteCsp } from '../server/http/csp.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

test('assetCdnOrigins: empty / junk values do not take the site down', () => {
  assert.deepEqual(assetCdnOrigins({}), []);
  assert.deepEqual(assetCdnOrigins({ SP_ASSET_CDN: '   ' }), []);
  assert.deepEqual(assetCdnOrigins({ SP_ASSET_CDN: 'not a url' }), []);
});

test('assetCdnOrigins: scheme+host kept, path dropped, duplicates removed', () => {
  assert.deepEqual(assetCdnOrigins({ SP_ASSET_CDN: 'https://cdn.example.com/assets/x?y=1' }), ['https://cdn.example.com']);
  assert.deepEqual(assetCdnOrigins({ SP_ASSET_CDN: 'https://a.example, http://b.example/' }), ['https://a.example', 'http://b.example']);
  assert.deepEqual(assetCdnOrigins({ SP_ASSET_CDN: 'https://a.example,https://a.example/x' }), ['https://a.example']);
});

test('siteCsp: no CDN configured keeps every asset directive same-origin', () => {
  const csp = siteCsp(publicDir, {});
  assert.match(csp, /img-src 'self' data: blob:;/);
  assert.match(csp, /media-src 'self';/);
  assert.doesNotMatch(csp, /speedcdn/);
});

test('siteCsp: a CDN deployment may load art, fonts, voice and downloads from that origin', () => {
  const csp = siteCsp(publicDir, { SP_ASSET_CDN: 'https://speedcdn.example.com' });
  for (const directive of ['style-src', 'font-src', 'img-src', 'media-src', 'connect-src']) {
    const part = csp.split('; ').find((s) => s.startsWith(directive + ' '));
    assert.ok(part, `missing ${directive}: ${csp}`);
    assert.ok(part.includes('https://speedcdn.example.com'), `${directive} must allow the CDN: ${part}`);
  }
});

test('siteCsp: the CDN origin never reaches script-src', () => {
  const csp = siteCsp(publicDir, { SP_ASSET_CDN: 'https://speedcdn.example.com' });
  const script = csp.split('; ').find((s) => s.startsWith('script-src '));
  assert.ok(script);
  assert.ok(!script.includes('speedcdn.example.com'), `script-src must stay same-origin: ${script}`);
});
