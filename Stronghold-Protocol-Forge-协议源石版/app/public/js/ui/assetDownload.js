// 标题页的「预载素材」（docs/history/0.3.0.md §34.14.23 的下载队列 + 2026-10-17 的两档改造）：
// 按钮、提示行和弹窗。弹窗**不自动开下载**：先让玩家选「画面」还是「全部（含语音）」，
// 因为整套语音是 344 MB（本服实测 17,762 个文件 / 789.6 MB，其中语音 11,450 个 / 344.4 MB）。
// 已导入的素材（ui/assetImport.js）直接算作就绪，不再向服务器请求。
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal, ProgressBar } from './components.js';
import { assetDownload } from '../assetDownload.js';
import { t } from '../../../shared/i18n.js';

/** 预载素材：按钮 + 提示行 + 选择/进度弹窗。 */
export function AssetDownloadButton() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(() => assetDownload.get());
  useEffect(() => {
    const off = assetDownload.subscribe(setState);
    setState(assetDownload.get());
    return () => {
      off();
      assetDownload.pause();
    };
  }, []);
  const busy = ['preparing', 'downloading'].includes(state.phase);
  const close = () => {
    assetDownload.pause();
    setOpen(false);
  };
  const status = state.phase === 'complete' ? t('本次素材下载完成')
    : state.phase === 'preparing' ? t('正在读取素材清单…')
      : state.phase === 'paused' ? t('素材下载已暂停')
        : state.phase === 'error' ? t('无法读取素材清单，请检查网络后重试。')
          : state.phase === 'partial' ? t('有 {n} 个素材下载失败', { n: state.failures.length })
            : t('请选择要预载的范围');
  const label = state.phase === 'complete' ? t('素材已下载')
    : state.phase === 'paused' ? t('继续下载素材') : t('预载素材');
  const restart = () => { void assetDownload.start(state.scope || 'visual'); };

  const ready = state.cached || 0;
  const missing = Math.max(0, (state.total || 0) - ready);
  return html`<div class="title-assets__item">
    <${Button} variant="secondary" block=${true} size="sm" data-testid="asset-download" aria-describedby="title-asset-download-hint" onClick=${() => setOpen(true)}>${label}<//>
    <small id="title-asset-download-hint">${t('画面约 450 MB、含语音约 790 MB，建议使用 Wi-Fi 下载。')}</small>
    <${Modal} open=${open} onClose=${close} title=${t('预载素材')} class="asset-download" actions=${html`
      ${busy ? html`<${Button} onClick=${() => assetDownload.pause()}>${t('暂停下载')}<//>`
        : html`<${Button} variant="primary" data-testid="asset-download-resume" onClick=${state.phase === 'idle' ? undefined : restart}>
          ${state.phase === 'complete' ? t('重新检查') : t('继续下载素材')}<//>`}
      <${Button} onClick=${close}>${t('关闭')}<//>`}>
      <p role="status" data-testid="asset-download-status">${status}</p>
      ${state.phase === 'idle' ? html`<div class="asset-download__choices">
        <${Button} variant="primary" block=${true} data-testid="asset-download-visual" onClick=${() => void assetDownload.start('visual')}>
          ${t('预载画面素材')} · ${t('约 450 MB')}<//>
        <${Button} variant="secondary" block=${true} data-testid="asset-download-all" onClick=${() => void assetDownload.start('all')}>
          ${t('预载全部（含语音）')} · ${t('约 790 MB')}<//>
        <p class="t-lo">${t('画面素材包含干员与敌人的模型、贴图和特效；语音是额外 344 MB。')}</p>
        <p class="t-lo">${t('不选也可以正常玩：没预载的部分会在用到时再下载。')}</p>
      </div>` : null}
      ${state.phase === 'idle' ? null : html`<div>
        <${ProgressBar} value=${state.done} max=${state.total || 1} label=${t('已完成 {done} / {total} 个文件', { done: state.done, total: state.total })} />
        <p>${t('已读取 {size} MB（含浏览器缓存）', { size: (state.bytes / 1048576).toFixed(1) })}</p>
        ${state.total > 0 ? html`<p>${t('已就绪 {ready}，缺少 {missing}', { ready, missing })}</p>` : null}
      </div>`}
      <p class="t-lo">${t('已导入的素材直接使用，不再向服务器请求。')}</p>
      <p class="t-lo">${t('素材会存进浏览器缓存：之后开局不会再临时下载，进房间更快。关闭窗口会暂停；缓存被清理后可再点一次。')}</p>
      ${state.localMissing ? html`<p class="t-lo">${t('服务器未提供额外的本地素材包，将使用基础素材。')}</p>` : null}
      ${state.failures.length ? html`<div class="asset-download__errors">
        <p>${t('下载未完成。请重试；若文件持续缺失，请联系服主补齐素材。')}</p>
        <details><summary>${t('查看失败文件')}</summary><ul>
          ${state.failures.slice(0, 30).map((item) => html`<li key=${item.url}><code>${item.url}</code> (${item.status})</li>`)}
        </ul></details>
      </div>` : null}
    <//>
  </div>`;
}
